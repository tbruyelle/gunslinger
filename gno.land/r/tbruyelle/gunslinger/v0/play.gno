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
	autoPass(g)
	save(g)
	emit("PlanSubmitted", "id", id, "turn", strconv.Itoa(turn), "player", caller.String(), "seat", strconv.Itoa(p))
	if resolved {
		emit("TurnResolved", "id", id, "turn", strconv.Itoa(turn), "rev", strconv.Itoa(g.Rev), "seed", seed)
	}
	return g.Rev
}

// autoPass passes the turn for every player who cannot play anything (a
// carried delay of 5 or more leaves no time points, rule 7.3): there is
// nothing to wait for from them. When nobody is left to wait for, the turn
// resolves at once, and so on while that lasts.
func autoPass(g *Game) {
	for g.Phase == PhasePlanning {
		for p := range g.Players {
			c := &g.State.Chars[p]
			if c.Status != engine.Alive || g.Submitted[p] || g.State.Budget(p) > 0 {
				continue
			}
			c.PlayedFoot = false
			c.PlayedRun = false
			g.Plans[p] = ""
			g.Submitted[p] = true
			emit("PlanPassed", "id", g.ID, "turn", strconv.Itoa(g.Turn), "seat", strconv.Itoa(p))
		}
		if !(g.Submitted[0] && g.Submitted[1]) {
			return
		}
		turn := g.Turn
		seed := resolveTurn(g)
		emit("TurnResolved", "id", g.ID, "turn", strconv.Itoa(turn), "rev", strconv.Itoa(g.Rev+1), "seed", seed)
	}
}

// resolveTurn plays both plans with the result deck shuffled from this
// turn's seed, stores the result and advances the game. It returns the seed
// in hex.
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
	start := snapshot(g.State.Chars)
	deck := engine.NewDeck(seed)
	st, evs := engine.Resolve(hex.A, g.State, plans, deck)
	st, endEvs := engine.EndTurn(st)
	evs = append(evs, endEvs...)
	if g.Turn >= g.MaxTurns && engine.AliveCount(st) > 1 { // the end-of-showdown SERIOUS wound check (14.5)
		st, endEvs = engine.EndShowdown(st, deck)
		evs = append(evs, endEvs...)
	}
	seedHex := enchex.EncodeToString(seed[:])
	g.Turns = append(g.Turns, &TurnResult{Turn: g.Turn, Start: start, Plans: g.Plans, Seed: seedHex, Cards: deck.Drawn(), Events: evs})
	g.State = st
	g.Plans = [engine.NumPlayers]string{}
	g.Submitted = [engine.NumPlayers]bool{}
	switch {
	case engine.AliveCount(g.State) == 0:
		g.finish("all_down", -1)
	case engine.AliveCount(g.State) == 1:
		g.finish("last_standing", lastAlive(g))
	case g.Turn >= g.MaxTurns:
		g.finish("max_turns", -1)
	default:
		g.Turn++
	}
	return seedHex
}

// snapshot copies the characters field by field. A plain array copy is not
// enough on a node: a character written earlier in the same transaction
// stayed shared with the live state, so the stored start of a turn showed its
// end position.
func snapshot(cs [engine.NumPlayers]engine.Character) (out [engine.NumPlayers]engine.Character) {
	for i, c := range cs {
		out[i] = engine.Character{
			Hex:        c.Hex,
			Facing:     c.Facing,
			Down:       c.Down,
			Delay:      c.Delay,
			Status:     c.Status,
			PlayedFoot:  c.PlayedFoot,
			PlayedRun:   c.PlayedRun,
			RanLastTurn: c.RanLastTurn,
			Dropped:     c.Dropped,
			Aim:         c.Aim,
			AimHex:      c.AimHex,
			Endurance:   c.Endurance,
			Exhausted:   c.Exhausted,
			Serious:     c.Serious,
			GunArm:      c.GunArm,
			OtherArm:    c.OtherArm,
			Leg:         c.Leg,
		}
		for j, g := range c.Guns {
			out[i].Guns[j] = engine.Gun{ID: g.ID, Type: g.Type, Location: g.Location, Cocked: g.Cocked, Shells: g.Shells, Jammed: g.Jammed, Exploded: g.Exploded}
		}
	}
	return out
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

// ClaimTimeout ends a game that saw no progress for its Timeout. Anyone may
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
