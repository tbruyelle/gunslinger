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
	// EndOfTurn is the Seg of events recorded after segment 5 (cancelled
	// actions, passing out, the end-of-showdown check); turn-start events
	// (SERIOUS fatigue, aim lost on the first reveal) have Seg 0.
	EndOfTurn = Segments + 1
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
	// Killed characters are out of the game (14.6).
	Killed
	// PassedOut characters carried more delay than endurance for two turns (14.2).
	PassedOut
)

// String returns the status name used in JSON views.
func (s Status) String() string {
	switch s {
	case Alive:
		return "alive"
	case Out:
		return "out"
	case Killed:
		return "killed"
	case PassedOut:
		return "passed_out"
	}
	return "?"
}

// StartEndurance is the endurance boxes a character starts with (14.2).
const StartEndurance = 20

// MaxAim is the most AIM points a character can hold on a target (12.3).
const MaxAim = 8

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
	// Dropped records a DROP penalty this turn ("Move" target status, 13.61).
	Dropped bool
	// Guns carried (section 10).
	Guns Guns
	// Aim is the AIM points on the target (12.2) and AimHex where they sit:
	// a hex, or "" when they are on the opponent and move along with it (12.3).
	Aim    int
	AimHex string
	// Endurance is the boxes left on the sheet (14.2); wound and fatigue
	// cards cross them off.
	Endurance int
	// Exhausted counts the consecutive turn ends with more delay than
	// endurance; two in a row pass the character out (14.2).
	Exhausted int
	// Permanent wounds (14.12): fatigue cards per turn, aim time penalties
	// per hand, fatigue cards per hex moved upright.
	Serious  int
	GunArm   int
	OtherArm int
	Leg      int
}

// GroundGun is a weapon lying in a hex (10.21).
type GroundGun struct {
	Hex string
	Gun Gun
}

// State is the whole game state the engine acts on.
type State struct {
	Chars  [NumPlayers]Character
	Ground []GroundGun
}

// NewState is the fixed showdown setup ([H3]): seat 0 in the north half of
// board A facing south, seat 1 in the south half facing north, six hexes apart.
func NewState() State {
	return State{Chars: [NumPlayers]Character{
		{Hex: "A-F3", Facing: hex.S, Guns: startingGuns(), Endurance: StartEndurance},
		{Hex: "A-F9", Facing: hex.N, Guns: startingGuns(), Endurance: StartEndurance},
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

// EndTurn is the end-of-turn upkeep (rule 5.6): half of the delay points
// are removed, rounded up, the per-turn flags are cleared, and a character
// left with more delay than endurance for the second turn in a row passes
// out (14.2; checked after the halving).
func EndTurn(s State) (State, []Event) {
	var evs []Event
	for p := range s.Chars {
		c := &s.Chars[p]
		c.Delay -= (c.Delay + 1) / 2
		c.RanLastTurn = c.PlayedRun
		c.PlayedFoot = false
		c.PlayedRun = false
		c.Dropped = false
		if c.Status != Alive {
			continue
		}
		if c.Delay > c.Endurance {
			c.Exhausted++
		} else {
			c.Exhausted = 0
		}
		if c.Exhausted >= 2 {
			c.Status = PassedOut
			c.Down = true
			c.Aim = 0
			evs = append(evs, Event{Seg: EndOfTurn, Player: p, Kind: EvPassOut, Down: true})
		}
	}
	return s, evs
}

// EndShowdown is the end-of-game check (14.5): every character with SERIOUS
// wounds draws a result card and is killed when its DELAY number plus the
// wound points reaches four.
func EndShowdown(s State, d Drawer) (State, []Event) {
	var evs []Event
	for p := range s.Chars {
		c := &s.Chars[p]
		if c.Status != Alive || c.Serious == 0 {
			continue
		}
		card := d.Draw()
		n := 0
		if card.Delay.IsPoints() {
			n = int(card.Delay)
		}
		evs = append(evs, Event{Seg: EndOfTurn, Player: p, Kind: EvSeriousCheck, Card: card.N, N: n + c.Serious})
		if n+c.Serious >= 4 {
			c.Status = Killed
			c.Down = true
			c.Aim = 0
			c.Delay = 0
			evs = append(evs, Event{Seg: EndOfTurn, Player: p, Kind: EvWound, Result: string(Kill)})
		}
	}
	return s, evs
}
