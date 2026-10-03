package engine

import (
	"errors"
	"strconv"
	"strings"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

const (
	// MaxPlanEntries bounds the number of actions in a plan; five 1-point
	// actions already fill the budget.
	MaxPlanEntries = MaxActionPoints
	// MaxPlanLen bounds the plan string length.
	MaxPlanLen = 128
)

// Action is one card side chosen for the turn, with its committed choice.
type Action struct {
	Card int
	Side byte // cards.FrontSide or cards.BackSide
	Code cards.Code
	Cost int
	Dir  hex.Rel // committed relative direction, "" when the side takes none
}

// Plan is the ordered stack of actions a player committed for the turn.
//
// Its string form, used as the transaction argument, is a comma-separated
// list of entries "<card><f|b>[:<dir>]", e.g. "1f:ahead_left,2f:ahead,3f".
// An empty string is a pass.
type Plan []Action

// ParsePlan parses the plan string. It checks the syntax and that every card
// side exists; Validate checks the game rules.
func ParsePlan(s string) (Plan, error) {
	if s == "" {
		return Plan{}, nil
	}
	if len(s) > MaxPlanLen {
		return nil, errors.New("plan is too long")
	}
	entries := strings.Split(s, ",")
	if len(entries) > MaxPlanEntries {
		return nil, errors.New("too many actions in plan")
	}
	plan := make(Plan, 0, len(entries))
	for _, e := range entries {
		a, err := parseEntry(e)
		if err != nil {
			return nil, err
		}
		plan = append(plan, a)
	}
	return plan, nil
}

func parseEntry(e string) (Action, error) {
	if e == "" {
		return Action{}, errors.New("empty action in plan")
	}
	dir := ""
	if i := strings.IndexByte(e, ':'); i >= 0 {
		e, dir = e[:i], e[i+1:]
		if dir == "" {
			return Action{}, errors.New("missing direction in " + strconv.Quote(e+":"))
		}
	}
	if len(e) < 2 {
		return Action{}, errors.New("invalid action " + strconv.Quote(e))
	}
	side := e[len(e)-1]
	num, err := strconv.Atoi(e[:len(e)-1])
	if err != nil || (side != cards.FrontSide && side != cards.BackSide) {
		return Action{}, errors.New("invalid action " + strconv.Quote(e))
	}
	def, ok := cards.Lookup(num, side)
	if !ok {
		return Action{}, errors.New("invalid action card " + strconv.Quote(e))
	}
	a := Action{Card: num, Side: side, Code: def.Code, Cost: def.Cost}
	if dir != "" {
		r, ok := hex.ParseRel(dir)
		if !ok {
			return Action{}, errors.New("invalid direction " + strconv.Quote(dir))
		}
		a.Dir = r
	}
	return a, nil
}

// String is the canonical plan string, parseable by ParsePlan.
func (p Plan) String() string {
	var b strings.Builder
	for i, a := range p {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.Itoa(a.Card))
		b.WriteByte(a.Side)
		if a.Dir != "" {
			b.WriteByte(':')
			b.WriteString(string(a.Dir))
		}
	}
	return b.String()
}

// Cost is the total time points of the plan.
func (p Plan) Cost() int {
	n := 0
	for _, a := range p {
		n += a.Cost
	}
	return n
}

// Has reports whether the plan holds the action.
func (p Plan) Has(code cards.Code) bool {
	for _, a := range p {
		if a.Code == code {
			return true
		}
	}
	return false
}

// PlayedFoot reports whether the plan holds any foot action ([H12]).
func (p Plan) PlayedFoot() bool {
	for _, a := range p {
		if def, ok := cards.Lookup(a.Card, a.Side); ok && def.Kind == cards.KindFoot {
			return true
		}
	}
	return false
}

// Validate checks the plan against the selection rules for the character
// that will play it (port of the BGA actConfirmPlan checks).
func (p Plan) Validate(c Character) error {
	used := map[int]bool{}
	for _, a := range p {
		def, ok := cards.Lookup(a.Card, a.Side)
		if !ok {
			return errors.New("invalid action card")
		}
		if !cards.Enabled(def.Code) {
			return errors.New("that action is not available yet")
		}
		if used[a.Card] { // rule 7.2: one side per card, once per turn
			return errors.New("you cannot use both sides of a card")
		}
		used[a.Card] = true
		switch {
		case def.Choice.IsAheadRel():
			if !a.Dir.IsAhead() {
				return errors.New("choose a forward direction")
			}
		case def.Choice.IsBackRel():
			if !a.Dir.IsBack() {
				return errors.New("choose a backward direction")
			}
		default:
			if a.Dir != "" {
				return errors.New("that action takes no direction")
			}
		}
	}
	budget := MaxActionPoints - c.Delay // [H5]
	if p.Cost() > budget {
		return errors.New("those actions cost more time points than you have")
	}
	// Prerequisite chains (rule 9.21).
	if p.Has(cards.Run) && !p.Has(cards.Advance) {
		return errors.New("run can only be played together with advance")
	}
	if p.Has(cards.Sprint) {
		if !p.Has(cards.Run) {
			return errors.New("sprint can only be played together with run")
		}
		if !c.RanLastTurn { // rule 9.23: speed is built up over two turns
			return errors.New("sprint can only be played after a run on the previous turn")
		}
	}
	return nil
}
