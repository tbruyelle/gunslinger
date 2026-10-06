package engine

import (
	"strings"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// Event kinds.
const (
	EvMove         = "move"          // From, To, Facing, Down, Action (Reason "stagger" when thrown by a hit)
	EvTurn         = "turn"          // Facing, Action (Reason "stagger" when thrown by a hit)
	EvFlip         = "flip"          // Down, Action (empty for a DROP penalty)
	EvDelay        = "delay"         // N gained, Reason, Card drawn (0 for crawl), Result penalty, Endurance crossed off, Delay = running total once this card is counted
	EvCancel       = "cancel"        // Action, Reason
	EvDraw         = "draw"          // Gun drawn from From (holster) to To (hand) and cocked
	EvCock         = "cock"          // Gun cocked
	EvUncock       = "uncock"        // Gun uncocked
	EvAim          = "aim"           // N = AIM points after aiming, To = the hex they sit on, Target = the seat they follow (-1 for a hex)
	EvLoseAim      = "lose_aim"      // Reason
	EvNothing      = "nothing"       // a Shoot used to do nothing (keeps the aim)
	EvShot         = "shot"          // Card, Target (-1 for a shot at a hex nobody stands in), To = the hex shot at, Hit (final location or Miss), Range, N = aim time, Reason "" | out_of_zone | misfire | empty_hex
	EvMalfunction  = "malfunction"   // Card, Result (no_effect, misfire, jams, explodes, no_penalty), Gun, GunID
	EvWildShot     = "wild_shot"     // Gun went off without hitting anything: uncocked, one shell less
	EvWound        = "wound"         // Player hit: Result = penalty kind (Kill, Stun...), N
	EvDirection    = "direction"     // Card drawn as a direction card: To = its HEX line
	EvDropGun      = "drop_gun"      // Gun fell from From (hand) to the hex To
	EvPassOut      = "pass_out"      // end of turn: more delay than endurance two turns in a row
	EvSeriousCheck = "serious_check" // end of showdown: Card, N = DELAY + SERIOUS points (4 kills)
)

// Delay and cancel reasons.
const (
	ReasonCrawl     = "crawl"       // moving while down (rule 9.2)
	ReasonSprint    = "sprint"      // sprinting draws a delay card (rule 9.23)
	ReasonLeap      = "leap"        // leap/drop draws two delay cards (rule 9.4)
	ReasonOccupied  = "occupied"    // ending a move in an occupied hex (rule 9.24)
	ReasonDrop      = "drop"        // a DROP penalty draws three delay cards (rule 14.11)
	ReasonStun      = "stun"        // a STUN draws wound cards (14.11)
	ReasonLight     = "light"       // a LIGHT draws fatigue cards (14.11)
	ReasonSerious   = "serious"     // fatigue cards at the start of the turn (14.12)
	ReasonLeg       = "leg"         // fatigue cards per hex moved upright (14.12)
	ReasonOffBoard  = "offboard"    // the move would leave the board
	ReasonTime      = "time"        // not executed by the end of segment 5 (rule 7.53)
	ReasonNoGun     = "no_gun"      // no gun in the box the action needs (11.3)
	ReasonHandFull  = "hand_full"   // the destination hand already holds a gun
	ReasonNotCocked = "not_cocked"  // shooting an uncocked gun (13.1)
	ReasonEmpty     = "empty"       // shooting a gun without shells (13.1)
	ReasonBroken    = "broken"      // shooting an exploded gun (13.31)
	ReasonNoTarget  = "no_target"   // the opponent is out of the fight (12.6)
	ReasonOutOfZone = "out_of_zone" // the opponent is in the blind zone (8.32, 12.41)
	ReasonReveal    = "reveal"      // revealing an action other than Turn or a gun action (12.44)
	ReasonTransfer  = "transfer"    // a new target more than one hex from the markers (12.5)
	ReasonNoHex     = "no_hex"      // aiming at a hex that is not on the board
	ReasonShot      = "shot"        // aim spent by a shot (12.43)
	ReasonStagger   = "stagger"     // thrown by a STAGGER penalty
	ReasonMisfire   = "misfire"     // the shot was cancelled by a MALFUNCTION
	ReasonEmptyHex  = "empty_hex"   // the shot went at a hex nobody stood in
)

// Malfunction results.
const (
	MalfNoEffect  = "no_effect"  // discarded, another card drawn (13.3)
	MalfMisfire   = "misfire"    // the shot is cancelled (13.3)
	MalfNoPenalty = "no_penalty" // second draw was a FIRE: the gun is fine (13.32)
)

// Event is one thing that happened during resolution, in order. Seg is 0
// for turn-start events and EndOfTurn for those after segment 5.
type Event struct {
	Seg       int
	Player    int
	Kind      string
	Action    cards.Code
	From      string
	To        string
	Facing    hex.Dir
	Down      bool
	N         int
	Delay     int
	Reason    string
	Card      int     // the result card drawn (0 when none)
	Result    string  // a card's penalty, a malfunction result or a wound's penalty kind
	Endurance int     // endurance boxes crossed off by a wound or fatigue card
	Target    int     // the seat shot at, for shots
	Hit       string  // the final hit location of a shot (Miss "-")
	Range     int     // the range of a shot, in hexes
	Gun       GunType // the gun's model, for gun events
	GunID     int     // the gun's id, for gun events
}

// pending is the combat results a shot inflicts on a seat, applied at the
// end of the segment (14.1), with the shooter for STAGGER's "Long" hex.
type pending struct {
	from int
	pens []Penalty
}

// Resolve plays both plans over the five segments of a turn (rules 5.5, 6,
// 7, 9, 12, 13, 14), deterministic for a given Drawer. Choices were
// committed up front and are resolved against each character's live state
// as the stacks play out.
//
// Each segment, every alive character whose next action is due
// (usedTime + cost + delay <= segment) executes it once, shots first
// (7.52). Delay gained during a segment and the results of hits take
// effect from the end of the segment ([H6], 14.1). Actions still pending
// after segment 5 are cancelled.
func Resolve(board *hex.Board, st State, plans [NumPlayers]Plan, d Drawer) (State, []Event) {
	var (
		used [NumPlayers]int
		idx  [NumPlayers]int
		evs  []Event
	)
	// Turn start: SERIOUS wounds draw fatigue cards (5.3), on the sheet
	// before segment 1.
	var startDelay [NumPlayers]int
	for p := range st.Chars {
		c := &st.Chars[p]
		startDelay[p] = c.Delay
		if c.Status != Alive {
			continue
		}
		for i := 0; i < c.Serious; i++ {
			c.Delay += drawCard(p, c, 0, ReasonSerious, fatigueLine, d, &evs)
		}
	}
	runningDelay(evs, startDelay)
	// Reveal the first actions (5.4): aim may be lost or moved (12.44, 12.5).
	for p := range st.Chars {
		if st.Chars[p].Status == Alive && len(plans[p]) > 0 {
			reveal(board, p, &st.Chars[p], &st.Chars[1-p], plans[p][0], 0, &evs)
		}
	}
	due := func(p int, seg int) bool {
		c := &st.Chars[p]
		return c.Status == Alive && idx[p] < len(plans[p]) && used[p]+plans[p][idx[p]].Cost+c.Delay <= seg
	}
	advance := func(p int, seg int) {
		used[p] += plans[p][idx[p]].Cost
		idx[p]++
		if st.Chars[p].Status == Alive && idx[p] < len(plans[p]) {
			reveal(board, p, &st.Chars[p], &st.Chars[1-p], plans[p][idx[p]], seg, &evs)
		}
	}
	for seg := 1; seg <= Segments; seg++ {
		var (
			gained  [NumPlayers]int
			moved   [NumPlayers]bool
			shot    [NumPlayers]bool
			results [NumPlayers][]pending
			first   = len(evs) // events of this segment start here
		)
		// Shots are resolved before the other actions (7.52).
		for p := 0; p < NumPlayers; p++ {
			if !due(p, seg) || !plans[p][idx[p]].IsShot() {
				continue
			}
			target := 1 - p
			pens := shoot(board, p, &st.Chars[p], target, &st.Chars[target], plans[p][idx[p]], seg, d, &evs)
			if len(pens) > 0 {
				results[target] = append(results[target], pending{from: p, pens: pens})
			}
			shot[p] = true
			advance(p, seg)
		}
		for p := 0; p < NumPlayers; p++ {
			if shot[p] || !due(p, seg) {
				continue
			}
			a := plans[p][idx[p]]
			g, executed := execute(board, p, a, &st.Chars[p], &st.Chars[1-p], seg, d, &evs)
			gained[p] += g
			advance(p, seg)
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

		// Combat results go into effect at the end of the segment (14.1).
		for p := 0; p < NumPlayers; p++ {
			for _, r := range results[p] {
				gained[p] += applyPenalties(board, p, &st, r, seg, d, &evs)
			}
		}
		// A target out of the aim zone at the end of the segment loses the aim (12.41).
		for p := 0; p < NumPlayers; p++ {
			c, t := &st.Chars[p], &st.Chars[1-p]
			if c.Status != Alive || c.Aim == 0 {
				continue
			}
			if c.AimHex == "" && t.Status != Alive { // the aim stays on a fallen target (12.6)
				continue
			}
			if !board.InAimZone(c.Hex, c.Facing, aimTarget(c, t)) {
				loseAim(p, c, seg, ReasonOutOfZone, &evs)
			}
		}

		// Delay gained this segment takes effect next segment (6.1, [H6]);
		// the events carry the running total as the cards come.
		for p := 0; p < NumPlayers; p++ {
			startDelay[p] = st.Chars[p].Delay
			if st.Chars[p].Status == Killed {
				continue // the delay gained before the kill is moot
			}
			st.Chars[p].Delay += gained[p]
		}
		runningDelay(evs[first:], startDelay)
	}

	// Cancel any action not executed by the end of segment 5 (7.53).
	for p := 0; p < NumPlayers; p++ {
		if st.Chars[p].Status != Alive {
			continue
		}
		for i := idx[p]; i < len(plans[p]); i++ {
			evs = append(evs, Event{Seg: EndOfTurn, Player: p, Kind: EvCancel, Action: plans[p][i].Code, Reason: ReasonTime})
		}
	}
	return st, evs
}

// aimTarget is the hex the AIM markers of c sit on: a hex, or the
// opponent's.
func aimTarget(c, opp *Character) string {
	if c.AimHex == "" {
		return opp.Hex
	}
	return c.AimHex
}

// runningDelay stamps each delay event with the delay points its player
// holds once that card is counted, starting from the given totals.
func runningDelay(evs []Event, start [NumPlayers]int) {
	for i := range evs {
		if evs[i].Kind == EvDelay {
			start[evs[i].Player] += evs[i].N
			evs[i].Delay = start[evs[i].Player]
		}
	}
}

// reveal applies rules 12.44 and 12.5 when an action becomes the next one:
// the aim is lost unless the action is a Turn, an aim or a shot (which
// spends it when it goes off); cocking, uncocking or doing nothing with a
// gun lose it like any other action. An aim or a shot naming a new target
// keeps the markers only within one hex of their place, and a shot moves
// them onto its target.
func reveal(board *hex.Board, p int, c *Character, opp *Character, a Action, seg int, evs *[]Event) {
	if c.Aim == 0 {
		return
	}
	switch {
	case a.Code == cards.Turn:
	case !cards.IsShooting(a.Code) || (a.Opt != OptAim && a.Opt != OptShoot):
		loseAim(p, c, seg, ReasonReveal, evs)
	case a.Opt == OptAim || a.Opt == OptShoot:
		// The target named: the markers move onto it within one hex (12.5).
		named := a.Hex
		if a.Target >= 0 {
			named = opp.Hex
		}
		if board.Distance(aimTarget(c, opp), named) > 1 {
			loseAim(p, c, seg, ReasonTransfer, evs)
		} else if a.Opt == OptShoot {
			c.AimHex = a.Hex // "" when the shot names the opponent
		}
	}
}

func loseAim(p int, c *Character, seg int, reason string, evs *[]Event) {
	if c.Aim == 0 {
		return
	}
	c.Aim = 0
	c.AimHex = ""
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvLoseAim, Reason: reason})
}

// cardLine is which line of a drawn result card is read.
type cardLine int

const (
	delayLine   cardLine = iota // delay card (14.21): DELAY line, no endurance
	fatigueLine                 // fatigue card (14.22): DELAY line, crosses off endurance
	woundLine                   // wound card (14.23): WOUND line, crosses off endurance
)

// drawCard draws one result card for c and reads the chosen line: a number
// is delay points (and endurance boxes for fatigue and wound cards); a
// penalty applies as in rule 14.11 (LOSE AIM, WILD SHOT fires every cocked
// gun, DROP turns the character DOWN and draws three more delay cards). One
// delay event is recorded per card drawn. It returns the delay points gained.
func drawCard(p int, c *Character, seg int, reason string, line cardLine, d Drawer, evs *[]Event) (gained int) {
	card := d.Draw()
	res := card.Delay
	if line == woundLine {
		res = card.Wound
	}
	ev := Event{Seg: seg, Player: p, Kind: EvDelay, Reason: reason, Card: card.N, Result: res.String()}
	if res.IsPoints() {
		gained = int(res)
		ev.N = gained
		if line != delayLine {
			ev.Endurance = gained
			c.Endurance -= gained
			if c.Endurance < 0 {
				c.Endurance = 0
			}
		}
	}
	*evs = append(*evs, ev)
	switch res {
	case LoseAim:
		loseAim(p, c, seg, res.String(), evs)
	case WildShot:
		wildShot(p, c, seg, evs)
		loseAim(p, c, seg, res.String(), evs)
	case Drop:
		gained += drop(p, c, seg, d, evs)
	}
	return gained
}

// drawDelay draws one delay card (14.21).
func drawDelay(p int, c *Character, seg int, reason string, d Drawer, evs *[]Event) int {
	return drawCard(p, c, seg, reason, delayLine, d, evs)
}

// drop is the DROP penalty (14.11): an upright character turns DOWN, draws
// three delay cards and loses its aim; no effect when already DOWN.
func drop(p int, c *Character, seg int, d Drawer, evs *[]Event) (gained int) {
	if c.Down {
		return 0
	}
	c.Down = true
	c.Dropped = true
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvFlip, Down: true})
	for i := 0; i < 3; i++ {
		gained += drawDelay(p, c, seg, ReasonDrop, d, evs)
	}
	loseAim(p, c, seg, ReasonDrop, evs)
	return gained
}

// wildShot fires every cocked gun of c without effect (rule 14.11).
func wildShot(p int, c *Character, seg int, evs *[]Event) {
	for i := range c.Guns {
		if c.Guns[i].Type != NoGun && c.Guns[i].Cocked {
			fireHarmlessly(p, &c.Guns[i], seg, evs)
		}
	}
}

// fireHarmlessly is one gun going off without hitting anything: uncocked,
// one shell less.
func fireHarmlessly(p int, g *Gun, seg int, evs *[]Event) {
	g.Cocked = false
	if g.Shells > 0 {
		g.Shells--
	}
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvWildShot, From: g.Location.String(), Gun: g.Type, GunID: g.ID})
}

// shoot resolves a shot (13): the gun must be cocked, loaded and in a box it
// fires from, else the action is cancelled; the target is the opponent,
// hit only inside the aim zone. A MALFUNCTION with no effect is replaced; a
// misfire cancels the shot and a second draw may jam or blow up the gun.
// The shooter then uncocks, spends a shell and loses the aim (13.9). It
// returns the IMPACT TABLE results of a hit, inflicted at the end of the
// segment.
func shoot(board *hex.Board, p int, c *Character, target int, t *Character, a Action, seg int, d Drawer, evs *[]Event) []Penalty {
	cancel := func(reason string) []Penalty {
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: reason})
		return nil
	}
	slot := c.Guns.Firing()
	if slot < 0 {
		return cancel(ReasonNoGun)
	}
	g := &c.Guns[slot]
	switch {
	case g.Exploded:
		return cancel(ReasonBroken)
	case g.Shells == 0:
		return cancel(ReasonEmpty)
	case !g.Cocked:
		return cancel(ReasonNotCocked)
	case a.Target >= 0 && (a.Target == p || t.Status != Alive):
		return cancel(ReasonNoTarget)
	}
	// The target: the opponent, or the hex named, where the opponent may or
	// may not stand when the shot goes off.
	at := t.Hex
	if a.Target < 0 {
		if !board.Has(a.Hex) {
			return cancel(ReasonNoHex)
		}
		at = a.Hex
	}
	onTarget := t.Status == Alive && t.Hex == at
	spec := g.Type.Spec()
	aim := a.AimTime(spec.OneHanded) + c.Aim
	if g.Location == GunHand || g.Location == BothHands {
		aim -= c.GunArm
	}
	if g.Location == OtherHand || g.Location == BothHands {
		aim -= c.OtherArm
	}
	rng := board.Distance(c.Hex, at)
	inZone := board.InAimZone(c.Hex, c.Facing, at)

	// Draw (13.2): a MALFUNCTION with no effect is replaced; a misfire
	// cancels the shot and draws again for the gun (13.3, 13.31).
	var card ResultCard
	misfire := false
	for tries := 0; tries < DeckSize; tries++ {
		card = d.Draw()
		if card.IsFire() {
			break
		}
		if !card.Malf.Handloaded { // the Colt 45 takes handloaded shells (26.2)
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMalfunction, Card: card.N, Result: MalfNoEffect, Gun: g.Type, GunID: g.ID})
			continue
		}
		misfire = true
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMalfunction, Card: card.N, Result: MalfMisfire, Gun: g.Type, GunID: g.ID})
		second := d.Draw()
		result := MalfNoPenalty
		if !second.IsFire() {
			result = second.Malf.Second
			if result == GunJams {
				g.Shells = 0
				g.Jammed = true
			} else {
				g.Exploded = true
			}
		}
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMalfunction, Card: second.N, Result: result, Gun: g.Type, GunID: g.ID})
		break
	}
	hit := Miss
	ev := Event{Seg: seg, Player: p, Kind: EvShot, Action: a.Code, Card: card.N, Target: -1, To: at, Range: rng, N: aim, Gun: g.Type, GunID: g.ID}
	if onTarget {
		ev.Target = target
	}
	switch {
	case misfire:
		ev.Reason = ReasonMisfire
	case !inZone:
		ev.Reason = ReasonOutOfZone
	case !onTarget:
		ev.Reason = ReasonEmptyHex
	default:
		hit = targetStatus(card, card.Fire.Lookup(aim, rng), t)
		if hit == Bullseye { // the shooter picks the location (13.7): the deadliest
			hit = VitalHit
		}
	}
	ev.Hit = string(hit)
	*evs = append(*evs, ev)

	// After the shot (13.9), even on a misfire.
	g.Cocked = false
	if g.Shells > 0 {
		g.Shells--
	}
	loseAim(p, c, seg, ReasonShot, evs)
	if hit == Miss {
		return nil
	}
	return Impact(spec.Impact, hit)
}

// targetStatus applies the card's Target Status entries to a preliminary
// hit (13.6): for Move and Run, a bullseye becomes the card's lesser hit
// and any other hit a miss; for Down, any hit but a bullseye misses. Head
// counters are not played.
func targetStatus(card ResultCard, hit HitLoc, t *Character) HitLoc {
	if hit == Miss {
		return Miss
	}
	lesser := card.Fire.Lesser()
	listed := func(s byte) bool { return strings.IndexByte(card.Status, s) >= 0 }
	for _, s := range []struct {
		letter byte
		on     bool
	}{{StatusMove, t.PlayedFoot || t.Dropped}, {StatusRun, t.PlayedRun}} {
		if !listed(s.letter) || !s.on {
			continue
		}
		if hit != Bullseye {
			return Miss
		}
		hit = lesser
	}
	if listed(StatusDown) && t.Down && hit != Bullseye {
		return Miss
	}
	return hit
}

// applyPenalties inflicts the results of a hit on seat p (14.11, 14.12),
// stopping once the character is out of the fight. It returns the delay
// points gained.
func applyPenalties(board *hex.Board, p int, st *State, r pending, seg int, d Drawer, evs *[]Event) (gained int) {
	c := &st.Chars[p]
	for _, pen := range r.pens {
		if c.Status != Alive {
			break
		}
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvWound, Result: string(pen.Kind), N: pen.N})
		switch pen.Kind {
		case Kill:
			c.Status = Killed
			c.Down = true
			c.Aim = 0
			c.Delay = 0 // a dead character carries no delay marker
		case Stun:
			for i := 0; i < pen.N; i++ {
				gained += drawCard(p, c, seg, ReasonStun, woundLine, d, evs)
			}
			loseAim(p, c, seg, string(Stun), evs)
		case Stagger:
			gained += stagger(board, p, c, &st.Chars[r.from], seg, d, evs)
		case Serious:
			c.Serious += pen.N
		case DropGunHand:
			dropHand(p, c, GunHand, OtherHand, seg, st, evs)
			loseAim(p, c, seg, string(DropGunHand), evs)
		case DropOtherHand:
			dropHand(p, c, OtherHand, GunHand, seg, st, evs)
			loseAim(p, c, seg, string(DropOtherHand), evs)
		case GunArm:
			c.GunArm += pen.N
		case OtherArm:
			c.OtherArm += pen.N
		case LegWound:
			c.Leg += pen.N
		case Light:
			for i := 0; i < pen.N; i++ {
				gained += drawCard(p, c, seg, ReasonLight, fatigueLine, d, evs)
			}
		}
	}
	return gained
}

// stagger is the STAGGER penalty (14.11): an upright character is thrown to
// the hex named by a first direction card, turns as named by a second one,
// and drops. A hex off the board keeps it in place.
func stagger(board *hex.Board, p int, c *Character, shooter *Character, seg int, d Drawer, evs *[]Event) (gained int) {
	if c.Down {
		return 0
	}
	first, second := d.Draw(), d.Draw()
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDirection, Card: first.N, To: string(first.Hex)})
	*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDirection, Card: second.N, To: string(second.Hex)})
	if dir, ok := directionOf(board, c, shooter, first.Hex); ok {
		if to, ok := board.Neighbor(c.Hex, dir); ok {
			from := c.Hex
			c.Hex = to
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMove, From: from, To: to, Facing: c.Facing, Down: c.Down, Reason: ReasonStagger})
		}
	}
	if dir, ok := directionOf(board, c, shooter, second.Hex); ok && dir != c.Facing {
		c.Facing = dir
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvTurn, Facing: c.Facing, Reason: ReasonStagger})
	}
	return gained + drop(p, c, seg, d, evs)
}

// directionOf turns a direction card's HEX line into an absolute direction
// from the target c (14.3): relative lines are taken from its facing,
// "long" continues the shooter's line, "same" names no direction.
func directionOf(board *hex.Board, c *Character, shooter *Character, h hex.Rel) (hex.Dir, bool) {
	switch h {
	case hex.Same:
		return 0, false
	case hex.Long:
		return board.LongDir(shooter.Hex, c.Hex, shooter.Facing), true
	}
	return hex.Resolve(c.Facing, h), true
}

// dropHand is the GUN HAND / OTHER HAND penalty (14.11): the weapon in that
// hand falls in the hex (a cocked gun going off), and a weapon in both
// hands moves to the other hand.
func dropHand(p int, c *Character, hand, other GunLocation, seg int, st *State, evs *[]Event) {
	if i := c.Guns.At(hand); i >= 0 {
		g := &c.Guns[i]
		if g.Cocked {
			fireHarmlessly(p, g, seg, evs)
		}
		dropped := *g
		dropped.Location = Holstered
		st.Ground = append(st.Ground, GroundGun{Hex: c.Hex, Gun: dropped})
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDropGun, From: hand.String(), To: c.Hex, Gun: g.Type, GunID: g.ID})
		*g = Gun{}
	}
	if i := c.Guns.At(BothHands); i >= 0 {
		c.Guns[i].Location = other
	}
}

// execute runs one action other than a shot, mutating c. It returns the
// delay points gained and whether the action took effect.
func execute(board *hex.Board, p int, a Action, c *Character, opp *Character, seg int, d Drawer, evs *[]Event) (gained int, executed bool) {
	cancel := func(reason string) (int, bool) {
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCancel, Action: a.Code, Reason: reason})
		return gained, false
	}
	move := func(dir hex.Dir) bool {
		to, ok := board.Neighbor(c.Hex, dir)
		if !ok {
			cancel(ReasonOffBoard)
			return false
		}
		from := c.Hex
		c.Hex = to
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvMove, Action: a.Code, From: from, To: to, Facing: c.Facing, Down: c.Down})
		if c.Down { // crawl penalty (9.2): a fixed 2 delay, no card
			gained += 2
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDelay, N: 2, Reason: ReasonCrawl})
		} else {
			for i := 0; i < c.Leg; i++ { // LEG wound (14.12)
				gained += drawCard(p, c, seg, ReasonLeg, fatigueLine, d, evs)
			}
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
			return cancel(ReasonNoGun)
		}
		if c.Guns.At(dest) >= 0 {
			return cancel(ReasonHandFull)
		}
		g := &c.Guns[slot]
		g.Location = dest
		g.Cocked = true
		*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvDraw, Action: a.Code, From: Holstered.String(), To: dest.String(), Gun: g.Type, GunID: g.ID})
		return 0, true
	case cards.CockAimShoot, cards.Shoot:
		if a.Opt == OptNothing {
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvNothing, Action: a.Code})
			return 0, true
		}
		slot := c.Guns.Firing() // a gun in the proper box (11.3)
		if slot < 0 {
			return cancel(ReasonNoGun)
		}
		g := &c.Guns[slot]
		switch a.Opt {
		case OptCock:
			g.Cocked = true
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvCock, Action: a.Code, Gun: g.Type, GunID: g.ID})
		case OptUncock:
			g.Cocked = false
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvUncock, Action: a.Code, Gun: g.Type, GunID: g.ID})
		case OptAim:
			// Two AIM points (12.1, 12.2) on the target named: the opponent,
			// wherever it is, or a hex; either must be in the aim zone.
			hexAt := a.Hex
			if a.Target >= 0 {
				if a.Target == p || opp.Status != Alive {
					return cancel(ReasonNoTarget)
				}
				hexAt = opp.Hex
			} else if !board.Has(a.Hex) {
				return cancel(ReasonNoHex)
			}
			if !board.InAimZone(c.Hex, c.Facing, hexAt) {
				return cancel(ReasonOutOfZone)
			}
			c.Aim += 2
			if c.Aim > MaxAim {
				c.Aim = MaxAim
			}
			c.AimHex = a.Hex // "" for the opponent: the markers follow it
			*evs = append(*evs, Event{Seg: seg, Player: p, Kind: EvAim, Action: a.Code, To: hexAt, Target: a.Target, N: c.Aim})
		}
		return 0, true
	}
	// Not implemented yet (loading, throwing, brawling): Validate rejects these upfront.
	return cancel("unsupported")
}
