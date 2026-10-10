// Package gunslinger is the on-chain lobby and referee of 2-player Gunslinger
// showdowns (the 1982 Avalon Hill gunfight game). Players create and join
// games and submit their turn plans; the realm resolves each turn with the
// pure engine package and keeps the result for the web client to animate.
package gunslinger

import (
	"time"

	"gno.land/p/nt/avl/v0"
	"gno.land/p/nt/seqid/v0"
	"gno.land/p/tbruyelle/gunslinger/engine/v0"
)

const (
	realmPath = "gno.land/r/tbruyelle/gunslinger/v0"

	// DefaultTimeout is how long a game may sit without progress before
	// anyone can call ClaimTimeout on it, when CreateGame gets 0.
	DefaultTimeout = 48 * time.Hour
	// MinTimeout and MaxTimeout bound the timeout a creator may pick.
	MinTimeout = 5 * time.Minute
	MaxTimeout = 30 * 24 * time.Hour
	// MinMaxTurns and MaxMaxTurns bound the game length.
	MinMaxTurns = 10
	MaxMaxTurns = 30
)

// Phase is where a game stands.
type Phase int

const (
	// PhaseWaiting: the creator is waiting for an opponent.
	PhaseWaiting Phase = iota
	// PhasePlanning: both seated; collecting the plans of the current turn.
	PhasePlanning
	// PhaseFinished: over, see Game.EndReason.
	PhaseFinished
)

// String returns the phase name used in JSON views.
func (p Phase) String() string {
	switch p {
	case PhaseWaiting:
		return "waiting"
	case PhasePlanning:
		return "planning"
	case PhaseFinished:
		return "finished"
	}
	return "?"
}

// Player is a seat: the address that controls it and its character token.
type Player struct {
	Addr address
	Char string
}

// TurnResult is the outcome of one resolved turn, kept so the client can
// replay it: the state the turn started from, the plans, and what happened.
// Seed lets anyone re-run the resolution; Cards is the trace of the result
// cards drawn from the deck it shuffles, in order. The start snapshot, the
// cards and the events are kept in the engine's compact text encodings: as
// structs they cost a hundred times more storage (see engine/encode.gno).
type TurnResult struct {
	Turn      int
	Plans     [engine.NumPlayers]string
	Seed      string
	StartEnc  string // engine.EncodeChars
	CardsEnc  string // engine.EncodeInts
	EventsEnc string // engine.EncodeEvents
}

func newTurnResult(turn int, start [engine.NumPlayers]engine.Character, plans [engine.NumPlayers]string, seed string, cards []int, evs []engine.Event) *TurnResult {
	return &TurnResult{Turn: turn, Plans: plans, Seed: seed, StartEnc: engine.EncodeChars(start), CardsEnc: engine.EncodeInts(cards), EventsEnc: engine.EncodeEvents(evs)}
}

// Start is the state of both seats when the turn began.
func (r *TurnResult) Start() [engine.NumPlayers]engine.Character { return engine.DecodeChars(r.StartEnc) }

// Cards is the result cards drawn during the turn, in order.
func (r *TurnResult) Cards() []int { return engine.DecodeInts(r.CardsEnc) }

// Events is what happened during the turn, in order.
func (r *TurnResult) Events() []engine.Event { return engine.DecodeEvents(r.EventsEnc) }

// Game is one showdown.
type Game struct {
	ID        string
	Players   [engine.NumPlayers]Player
	State     engine.State
	Turn      int // 1-based
	MaxTurns  int
	Timeout   time.Duration // inactivity after which ClaimTimeout succeeds
	Phase     Phase
	Plans     [engine.NumPlayers]string // current turn, canonical form
	Submitted [engine.NumPlayers]bool
	Turns     []*TurnResult // resolved turns, in order (at most MaxTurns)
	Winner    int // seat index, -1 for none
	EndReason string
	Rev       int // bumped on every change; clients poll it
	CreatedAt time.Time
	UpdatedAt time.Time
}

var (
	games     = avl.NewTree() // id -> *Game
	gameSeq   seqid.ID
	byPlayer  = avl.NewTree() // address -> []string game ids, newest first
	openGames = avl.NewTree() // id -> *Game while waiting for an opponent
)

func getGame(id string) *Game {
	if _, err := seqid.FromString(id); err != nil {
		panic("gunslinger: invalid game id")
	}
	v := games.Get(id)
	if v == nil {
		panic("gunslinger: game not found")
	}
	return v.(*Game)
}

// seat returns the seat of addr in g, or -1.
func (g *Game) seat(addr address) int {
	for i, p := range g.Players {
		if p.Addr == addr && p.Addr != "" {
			return i
		}
	}
	return -1
}

func (g *Game) mustSeat(addr address) int {
	p := g.seat(addr)
	if p < 0 {
		panic("gunslinger: you are not a player of this game")
	}
	return p
}

// lastTurn is the most recently resolved turn, or nil.
func (g *Game) lastTurn() *TurnResult {
	if len(g.Turns) == 0 {
		return nil
	}
	return g.Turns[len(g.Turns)-1]
}

// timeoutAt is when the game becomes claimable through ClaimTimeout.
func (g *Game) timeoutAt() time.Time { return g.UpdatedAt.Add(g.Timeout) }

func (g *Game) finish(reason string, winner int) {
	g.Phase = PhaseFinished
	g.EndReason = reason
	g.Winner = winner
	w := ""
	if winner >= 0 {
		w = g.Players[winner].Addr.String()
	}
	emit("GameEnded", "id", g.ID, "reason", reason, "winner", w)
}

// save records a change: bumps the revision and the activity clock.
func save(g *Game) {
	g.Rev++
	g.UpdatedAt = time.Now()
	games.Set(g.ID, g)
}

func index(addr address, id string) {
	var ids []string
	if v := byPlayer.Get(addr.String()); v != nil {
		ids = v.([]string)
	}
	byPlayer.Set(addr.String(), append([]string{id}, ids...))
}

func assertCharKey(charKey string) {
	if !engine.IsCharKey(charKey) {
		panic("gunslinger: unknown character " + charKey)
	}
}
