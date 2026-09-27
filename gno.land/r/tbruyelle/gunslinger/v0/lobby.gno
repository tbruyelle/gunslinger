package gunslinger

import (
	"strconv"
	"time"

	"gno.land/p/tbruyelle/gunslinger/engine/v0"
)

// CreateGame opens a showdown with the caller in seat 0 playing charKey,
// and returns the game id. maxTurns 0 means DefaultMaxTurns.
func CreateGame(cur realm, charKey string, maxTurns int) string {
	caller := cur.Previous().Address()
	assertCharKey(charKey)
	if maxTurns == 0 {
		maxTurns = DefaultMaxTurns
	}
	if maxTurns < 1 || maxTurns > MaxMaxTurns {
		panic("gunslinger: maxTurns must be between 1 and " + strconv.Itoa(MaxMaxTurns))
	}
	id := gameSeq.Next().String()
	g := &Game{
		ID:        id,
		State:     engine.NewState(),
		Turn:      1,
		MaxTurns:  maxTurns,
		Phase:     PhaseWaiting,
		Winner:    -1,
		CreatedAt: time.Now(),
	}
	g.Players[0] = Player{Addr: caller, Char: charKey}
	openGames.Set(id, g)
	index(caller, id)
	save(g)
	emit("GameCreated", "id", id, "creator", caller.String(), "char", charKey, "maxTurns", strconv.Itoa(maxTurns))
	return id
}

// JoinGame seats the caller in seat 1 of a waiting game, which then starts
// collecting plans for turn 1.
func JoinGame(cur realm, id string, charKey string) {
	caller := cur.Previous().Address()
	g := getGame(id)
	if g.Phase != PhaseWaiting {
		panic("gunslinger: game is not open")
	}
	if g.Players[0].Addr == caller {
		panic("gunslinger: you cannot join your own game")
	}
	assertCharKey(charKey)
	g.Players[1] = Player{Addr: caller, Char: charKey}
	g.Phase = PhasePlanning
	openGames.Remove(id)
	index(caller, id)
	save(g)
	emit("PlayerJoined", "id", id, "player", caller.String(), "char", charKey)
}

// CancelGame withdraws a game nobody joined yet. Creator only.
func CancelGame(cur realm, id string) {
	caller := cur.Previous().Address()
	g := getGame(id)
	if g.Phase != PhaseWaiting {
		panic("gunslinger: only a game waiting for an opponent can be cancelled")
	}
	if g.Players[0].Addr != caller {
		panic("gunslinger: only the creator can cancel the game")
	}
	openGames.Remove(id)
	g.finish("cancelled", -1)
	save(g)
}
