// Package engine is the pure, deterministic rules engine of a 2-player
// gunfight: plan parsing and validation, and the 5-segment resolution of a
// turn. It has no chain dependency so it can be unit-tested with gno test.
package engine

import "gno.land/p/tbruyelle/gunslinger/hex/v0"

const (
	// MaxActionPoints is the time points a plan may spend in a turn (rule 7.3).
	MaxActionPoints = 5
	// Segments is the number of segments in a turn (rule 4.1).
	Segments = 5
	// NumPlayers is the number of seats in a game.
	NumPlayers = 2
)

// Status is the participation state of a character.
type Status int

const (
	// Alive characters plan and act.
	Alive Status = iota
	// Out characters (resigned, timed out) are skipped by Resolve.
	Out
)

// String returns the status name used in JSON views.
func (s Status) String() string {
	switch s {
	case Alive:
		return "alive"
	case Out:
		return "out"
	}
	return "?"
}

// Character is the mutable state of one gunslinger.
type Character struct {
	Hex    string
	Facing hex.Dir
	Down   bool
	Delay  int // delay points on the sheet (rule 6)
	Status Status
	// PlayedFoot and PlayedRun record whether the current turn's plan holds
	// a foot action / a Run, whether or not it executes ([H12], rules 13.61-62).
	PlayedFoot bool
	PlayedRun  bool
	// RanLastTurn is PlayedRun carried over from the previous turn: Sprint
	// needs a Run on the previous turn as well (rule 9.23, "build up speed").
	RanLastTurn bool
	// Guns carried; gun actions are not implemented yet, so they do not change.
	Guns Guns
}

// State is the whole game state the engine acts on.
type State struct {
	Chars [NumPlayers]Character
}

// NewState is the fixed showdown setup ([H3]): seat 0 in the north half of
// board A facing south, seat 1 in the south half facing north, six hexes apart.
func NewState() State {
	return State{Chars: [NumPlayers]Character{
		{Hex: "A-F3", Facing: hex.S, Guns: startingGuns()},
		{Hex: "A-F9", Facing: hex.N, Guns: startingGuns()},
	}}
}

// Budget is the time points seat p may plan this turn: the carried delay
// counts against the 5 points ([H5], rule 7.3).
func (s State) Budget(p int) int {
	b := MaxActionPoints - s.Chars[p].Delay
	if b < 0 {
		return 0
	}
	return b
}

// AliveCount counts the characters still in the fight.
func AliveCount(s State) int {
	n := 0
	for _, c := range s.Chars {
		if c.Status == Alive {
			n++
		}
	}
	return n
}

// EndTurn is the end-of-turn upkeep (rule 6.3): half of the delay points are
// removed, rounded up, and the per-turn flags are cleared.
func EndTurn(s State) State {
	for p := range s.Chars {
		c := &s.Chars[p]
		c.Delay -= (c.Delay + 1) / 2
		c.RanLastTurn = c.PlayedRun
		c.PlayedFoot = false
		c.PlayedRun = false
	}
	return s
}
