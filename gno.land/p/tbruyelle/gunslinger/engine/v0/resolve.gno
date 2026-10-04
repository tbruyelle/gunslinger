package engine

import (
	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// Event kinds.
const (
	EvMove     = "move"      // From, To, Facing, Down, Action
	EvTurn     = "turn"      // Facing, Action
	EvFlip     = "flip"      // Down, Action (empty for a DROP penalty)
	EvDelay    = "delay"     // N gained, Reason, Card drawn (0 for crawl), Result penalty, Delay = total after the segment
	EvCancel   = "cancel"    // Action, Reason
	EvDraw     = "draw"      // Gun drawn from From (holster) to To (gun hand) and cocked
	EvWildShot = "wild_shot" // Gun went off without hitting anything: uncocked, one shell less
)

// Delay and cancel reasons.
const (
	ReasonCrawl    = "crawl"     // moving while down (rule 9.2)
	ReasonSprint   = "sprint"    // sprinting draws a delay card (rule 9.23)
	ReasonLeap     = "leap"      // leap/drop draws two delay cards (rule 9.4)
	ReasonOccupied = "occupied"  // ending a move in an occupied hex (rule 9.24)
	ReasonDrop     = "drop"      // a DROP penalty draws three delay cards (rule 14.11)
	ReasonOffBoard = "offboard"  // the move would leave the board
	ReasonTime     = "time"      // not executed by the end of segment 5 (rule 7.53)
	ReasonNoGun    = "no_gun"    // the gun to draw is no longer in a holster
	ReasonHandFull = "hand_full" // the destination hand already holds a gun
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
	Card   int     // the result card drawn, for delay events (0 when no card was drawn)
	Result string  // the card's penalty when its DELAY line is not a number
	Gun    GunType // the gun's model, for gun events
	GunID  int     // the gun's id, for gun events
}

// Resolve plays both plans over the five segments of a turn (rules 5.5, 6,
// 7, 9), deterministic for a given Drawer. Choices were committed up front
// and are resolved against each character's live facing and position as the
// stacks play out.
//
// Each segment, every alive character whose next action is due
// (usedTime + cost + delay <= segment) executes it once. Delay gained during
// a segment takes effect from the next one ([H6]). Actions still pending
// after segment 5 are cancelled.
func Resolve(board *hex.Board, st State, plans [NumPlayers]Plan, d Drawer) (State, []Event) {
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
				gained[p] += drawDelay(p, &st.Chars[p], seg, ReasonOccupied, d, &evs)
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

// drawDelay draws one delay card for c (rule 14.21): a number on the DELAY
// line is delay points; a penalty applies as in rule 14.11 (LOSE AIM has no
// effect yet, WILD SHOT fires every cocked gun, DROP turns the character
// DOWN and draws three more cards). One delay event is recorded per card
// drawn. It returns the delay points gained.
func drawDelay(p int, c *Character, seg int, reason string, d Drawer, evs *[]Event) (gained int) {
	card := d.Draw()
	if card.Delay.IsPoints() {
		gained = int(card.Delay)
	}
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDelay, N: gained, Reason: reason, Card: card.N, Result: card.Delay.String()})
	switch card.Delay {
	case WildShot:
		wildShot(p, c, seg, evs)
	case Drop:
		if !c.Down {
			c.Down = true
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvFlip, Down: true})
			for i := 0; i < 3; i++ {
				gained += drawDelay(p, c, seg, ReasonDrop, d, evs)
			}
		}
	}
	return gained
}

// wildShot fires every cocked gun of c without effect (rule 14.11): the gun
// is uncocked and loses a shell.
func wildShot(p int, c *Character, seg int, evs *[]Event) {
	for i := range c.Guns {
		g := &c.Guns[i]
		if g.Type == NoGun || !g.Cocked {
			continue
		}
		g.Cocked = false
		if g.Shells > 0 {
			g.Shells--
		}
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvWildShot, From: g.Location.String(), Gun: g.Type, GunID: g.ID})
	}
}

// execute runs one action, mutating c. It returns the delay points gained
// and whether the action took effect.
func execute(board *hex.Board, p int, a Action, c *Character, seg int, d Drawer, evs *[]Event) (gained int, executed bool) {
	move := func(dir hex.Dir) bool {
		to, ok := board.Neighbor(c.Hex, dir)
		if !ok {
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: ReasonOffBoard})
			return false
		}
		from := c.Hex
		c.Hex = to
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMove, Action: a.Code, From: from, To: to, Facing: c.Facing, Down: c.Down})
		if c.Down { // crawl penalty (9.2): a fixed 2 delay, no card
			gained += 2
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDelay, N: 2, Reason: ReasonCrawl})
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
		gained += drawDelay(p, c, seg, ReasonSprint, d, evs)
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
		// Two delay cards (9.4).
		gained += drawDelay(p, c, seg, ReasonLeap, d, evs)
		gained += drawDelay(p, c, seg, ReasonLeap, d, evs)
		return gained, true
	case cards.DrawAndCock:
		// Take the chosen gun from its holster to the gun hand and cock it.
		slot := c.Guns.Find(a.Gun)
		dest, ok := HandLocation(a.Hand)
		if slot < 0 || c.Guns[slot].Location != Holstered || !ok {
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: ReasonNoGun})
			return 0, false
		}
		if c.Guns.At(dest) >= 0 {
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: ReasonHandFull})
			return 0, false
		}
		g := &c.Guns[slot]
		g.Location = dest
		g.Cocked = true
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDraw, Action: a.Code, From: Holstered.String(), To: dest.String(), Gun: g.Type, GunID: g.ID})
		return 0, true
	}
	// Not implemented yet (guns, brawling): Validate rejects these upfront.
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: "unsupported"})
	return 0, false
}
