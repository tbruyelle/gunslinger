package engine

import (
	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// Event kinds.
const (
	EvMove   = "move"   // From, To, Facing, Down, Action
	EvTurn   = "turn"   // Facing, Action
	EvFlip   = "flip"   // Down, Action
	EvDelay  = "delay"  // N gained, Reason, Delay = total after the segment
	EvCancel = "cancel" // Action, Reason
)

// Delay and cancel reasons.
const (
	ReasonCrawl    = "crawl"    // moving while down (rule 9.2)
	ReasonSprint   = "sprint"   // sprinting draws a delay card (rule 9.23)
	ReasonLeap     = "leap"     // leap/drop draws two delay cards (rule 9.4)
	ReasonOccupied = "occupied" // ending a move in an occupied hex (rule 9.24)
	ReasonOffBoard = "offboard" // the move would leave the board
	ReasonTime     = "time"     // not executed by the end of segment 5 (rule 7.53)
)

// Event is one thing that happened during resolution, in order. Seg is 0
// for end-of-turn cancellations.
type Event struct {
	Seg    int
	Player int
	Kind   string
	Action cards.Code
	From   string
	To     string
	Facing hex.Dir
	Down   bool
	N      int
	Delay  int
	Reason string
}

// Resolve plays both plans over the five segments of a turn (rules 5.5, 6,
// 7, 9), deterministic for a given Dice. Choices were committed up front
// and are resolved against each character's live facing and position as the
// stacks play out.
//
// Each segment, every alive character whose next action is due
// (usedTime + cost + delay <= segment) executes it once. Delay gained during
// a segment takes effect from the next one ([H6]). Actions still pending
// after segment 5 are cancelled.
func Resolve(board *hex.Board, st State, plans [NumPlayers]Plan, d Dice) (State, []Event) {
	var (
		used [NumPlayers]int
		idx  [NumPlayers]int
		evs  []Event
	)
	for seg := 1; seg <= Segments; seg++ {
		var (
			gained [NumPlayers]int
			moved  [NumPlayers]bool
			first  = len(evs) // events of this segment start here
		)
		for p := 0; p < NumPlayers; p++ {
			c := &st.Chars[p]
			if c.Status != Alive || idx[p] >= len(plans[p]) {
				continue
			}
			a := plans[p][idx[p]]
			if used[p]+a.Cost+c.Delay > seg {
				continue // not due yet
			}
			g, executed := execute(board, p, a, c, seg, d, &evs)
			gained[p] += g
			used[p] += a.Cost
			idx[p]++
			if executed && cards.IsMove(a.Code) {
				moved[p] = true
			}
		}

		// Occupied-hex penalty (9.24): when a mover ends the segment in
		// another character's hex, both draw one delay card (once each).
		for p := 0; p < NumPlayers; p++ {
			if st.Chars[p].Status != Alive {
				continue
			}
			for o := 0; o < NumPlayers; o++ {
				if o == p || st.Chars[o].Status != Alive || st.Chars[p].Hex != st.Chars[o].Hex || !(moved[p] || moved[o]) {
					continue
				}
				n := d.DrawDelay()
				gained[p] += n
				evs = append(evs, Event{Seg: seg, Player: p, Kind: EvDelay, N: n, Reason: ReasonOccupied})
				break
			}
		}

		// Delay gained this segment takes effect next segment (6.1, [H6]).
		for p := 0; p < NumPlayers; p++ {
			st.Chars[p].Delay += gained[p]
		}
		for i := first; i < len(evs); i++ {
			if evs[i].Kind == EvDelay {
				evs[i].Delay = st.Chars[evs[i].Player].Delay
			}
		}
	}

	// Cancel any action not executed by the end of segment 5 (7.53).
	for p := 0; p < NumPlayers; p++ {
		if st.Chars[p].Status != Alive {
			continue
		}
		for i := idx[p]; i < len(plans[p]); i++ {
			evs = append(evs, Event{Player: p, Kind: EvCancel, Action: plans[p][i].Code, Reason: ReasonTime})
		}
	}
	return st, evs
}

// execute runs one action, mutating c. It returns the delay points gained
// and whether the action took effect.
func execute(board *hex.Board, p int, a Action, c *Character, seg int, d Dice, evs *[]Event) (gained int, executed bool) {
	delay := func(n int, reason string) {
		gained += n
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDelay, N: n, Reason: reason})
	}
	move := func(dir hex.Dir) bool {
		to, ok := board.Neighbor(c.Hex, dir)
		if !ok {
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: ReasonOffBoard})
			return false
		}
		from := c.Hex
		c.Hex = to
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMove, Action: a.Code, From: from, To: to, Facing: c.Facing, Down: c.Down})
		if c.Down {
			delay(2, ReasonCrawl) // crawl penalty (9.2)
		}
		return true
	}

	switch a.Code {
	case cards.Advance, cards.Run, cards.BackUp:
		ok := move(hex.Resolve(c.Facing, a.Dir))
		return gained, ok
	case cards.Sprint:
		if !move(c.Facing) { // straight ahead (9.23)
			return gained, false
		}
		delay(d.DrawDelay(), ReasonSprint)
		return gained, true
	case cards.Turn, cards.SpinAround:
		c.Facing = hex.Resolve(c.Facing, a.Dir)
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvTurn, Action: a.Code, Facing: c.Facing})
		return 0, true
	case cards.GetUpDown:
		c.Down = !c.Down
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvFlip, Action: a.Code, Down: c.Down})
		return 0, true
	case cards.LeapDrop:
		c.Down = !c.Down
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvFlip, Action: a.Code, Down: c.Down})
		delay(d.DrawDelay()+d.DrawDelay(), ReasonLeap) // two delay cards (9.4)
		return gained, true
	}
	// Not implemented yet (guns, brawling): Validate rejects these upfront.
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: "unsupported"})
	return 0, false
}
