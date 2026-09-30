package gunslinger

import (
	"chain/runtime"
	enchex "encoding/hex"
	"strconv"
	"time"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/engine/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// SubmitPlan commits the caller's ordered action stack for the current turn
// and returns the game revision. The plan string is a comma-separated list of
// "<card><f|b>[:<direction>]" entries, e.g. "1f:ahead_left,2f:ahead,3f"; an
// empty string passes. Once both players have submitted, the turn resolves in
// this same transaction and the next turn starts.
func SubmitPlan(cur realm, id string, plan string) int {
	caller := cur.Previous().Address()
	g := getGame(id)
	if g.Phase != PhasePlanning {
		panic("gunslinger: game is not accepting plans")
	}
	p := g.mustSeat(caller)
	if g.Submitted[p] {
		panic("gunslinger: plan already submitted for this turn")
	}
	pl, err := engine.ParsePlan(plan)
	if err != nil {
		panic("gunslinger: " + err.Error())
	}
	if err := pl.Validate(g.State.Chars[p]); err != nil {
		panic("gunslinger: " + err.Error())
	}
	// Target-status flags for this turn, set whether or not the actions
	// end up executing ([H12]).
	g.State.Chars[p].PlayedFoot = pl.PlayedFoot()
	g.State.Chars[p].PlayedRun = pl.Has(cards.Run)
	g.Plans[p] = pl.String()
	g.Submitted[p] = true

	turn := g.Turn
	resolved := g.Submitted[0] && g.Submitted[1]
	var seed string
	if resolved {
		seed = resolveTurn(g)
	}
	save(g)
	emit("PlanSubmitted", "id", id, "turn", strconv.Itoa(turn), "player", caller.String(), "seat", strconv.Itoa(p))
	if resolved {
		emit("TurnResolved", "id", id, "turn", strconv.Itoa(turn), "rev", strconv.Itoa(g.Rev), "seed", seed)
	}
	return g.Rev
}

// resolveTurn plays both plans, stores the result and advances the game.
// It returns the dice seed in hex.
func resolveTurn(g *Game) string {
	seed := engine.Seed(realmPath, g.ID, strconv.Itoa(g.Turn), g.Plans[0], g.Plans[1],
		strconv.FormatInt(runtime.ChainHeight(), 10), strconv.FormatInt(time.Now().UnixNano(), 10))
	var plans [engine.NumPlayers]engine.Plan
	for i, s := range g.Plans {
		pl, err := engine.ParsePlan(s)
		if err != nil {
			panic("gunslinger: stored plan is invalid: " + err.Error())
		}
		plans[i] = pl
	}
	st, evs := engine.Resolve(hex.A, g.State, plans, engine.NewDice(seed))
	seedHex := enchex.EncodeToString(seed[:])
	g.LastTurn = &TurnResult{Turn: g.Turn, Plans: g.Plans, Seed: seedHex, Events: evs}
	g.State = engine.EndTurn(st)
	g.Plans = [engine.NumPlayers]string{}
	g.Submitted = [engine.NumPlayers]bool{}
	if engine.AliveCount(g.State) <= 1 {
		g.finish("last_standing", lastAlive(g))
	} else if g.Turn >= g.MaxTurns {
		g.finish("max_turns", -1)
	} else {
		g.Turn++
	}
	return seedHex
}

func lastAlive(g *Game) int {
	for i, c := range g.State.Chars {
		if c.Status == engine.Alive {
			return i
		}
	}
	return -1
}

// Resign forfeits the game to the opponent.
func Resign(cur realm, id string) {
	caller := cur.Previous().Address()
	g := getGame(id)
	if g.Phase != PhasePlanning {
		panic("gunslinger: game is not in progress")
	}
	p := g.mustSeat(caller)
	g.State.Chars[p].Status = engine.Out
	g.finish("resign", 1-p)
	save(g)
}

// ClaimTimeout ends a game that saw no progress for TurnTimeout. Anyone may
// call it. A waiting game expires; when exactly one player submitted a
// plan, the other forfeits; when neither did, the game is abandoned.
func ClaimTimeout(cur realm, id string) {
	g := getGame(id)
	if g.Phase == PhaseFinished {
		panic("gunslinger: game is finished")
	}
	if time.Now().Before(g.timeoutAt()) {
		panic("gunslinger: the game has not timed out yet")
	}
	switch {
	case g.Phase == PhaseWaiting:
		openGames.Remove(id)
		g.finish("expired", -1)
	case g.Submitted[0] != g.Submitted[1]:
		loser := 0
		if g.Submitted[0] {
			loser = 1
		}
		g.State.Chars[loser].Status = engine.Out
		g.finish("timeout", 1-loser)
	default:
		g.finish("abandoned", -1)
	}
	save(g)
}
