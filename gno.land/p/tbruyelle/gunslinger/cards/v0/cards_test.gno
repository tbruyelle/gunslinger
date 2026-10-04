package cards

import "testing"

func TestDeck(t *testing.T) {
	// Costs and choices as printed on the cards (see the table in CLAUDE.md).
	type want struct {
		code   Code
		cost   int
		choice Choice
	}
	table := [12][2]want{
		{{Advance, 2, ChoiceMoveAhead}, {BackUp, 3, ChoiceMoveBack}},
		{{Run, 1, ChoiceMoveAhead}, {SpinAround, 2, ChoiceTurnBack}},
		{{Sprint, 1, ChoiceNone}, {Turn, 1, ChoiceTurnAhead}},
		{{Sprint, 1, ChoiceNone}, {LeapDrop, 1, ChoiceNone}},
		{{CockAimShoot, 2, ChoiceTargetRanged}, {GetUpDown, 3, ChoiceNone}},
		{{CockAimShoot, 2, ChoiceTargetRanged}, {Throw, 2, ChoiceTargetRanged}},
		{{Shoot, 1, ChoiceTargetRanged}, {Strength, 2, ChoiceNone}},
		{{Load, 3, ChoiceNone}, {HeadOutBack, 2, ChoiceNone}},
		{{DrawAndCock, 3, ChoiceGun}, {HeadOutBack, 2, ChoiceNone}},
		{{Jab, 2, ChoiceTargetMelee}, {Duck, 1, ChoiceTargetDefend}},
		{{Swing, 3, ChoiceTargetMelee}, {Block, 2, ChoiceTargetDefend}},
		{{Belt, 3, ChoiceTargetMelee}, {Guard, 2, ChoiceTargetDefend}},
	}
	for i, c := range Cards {
		if c.Number != i+1 {
			t.Errorf("Cards[%d].Number = %d", i, c.Number)
		}
		for j, side := range [2]Side{c.Front, c.Back} {
			w := table[i][j]
			if side.Code != w.code || side.Cost != w.cost || side.Choice != w.choice {
				t.Errorf("card %d side %d = %+v, want %+v", i+1, j, side, w)
			}
			if side.Name == "" {
				t.Errorf("card %d side %d has no name", i+1, j)
			}
			if side.Cost < 1 || side.Cost > 3 {
				t.Errorf("card %d side %d cost %d out of range", i+1, j, side.Cost)
			}
		}
	}
}

func TestLookup(t *testing.T) {
	s, ok := Lookup(1, 'f')
	if !ok || s.Code != Advance {
		t.Errorf("Lookup(1, f) = %+v, %v", s, ok)
	}
	s, ok = Lookup(12, 'b')
	if !ok || s.Code != Guard {
		t.Errorf("Lookup(12, b) = %+v, %v", s, ok)
	}
	for _, bad := range []struct {
		n    int
		side byte
	}{{0, 'f'}, {13, 'f'}, {1, 'x'}, {1, 'F'}, {-1, 'b'}} {
		if _, ok := Lookup(bad.n, bad.side); ok {
			t.Errorf("Lookup(%d, %c) accepted", bad.n, bad.side)
		}
	}
}

func TestEnabledAndKinds(t *testing.T) {
	enabled := map[Code]bool{}
	for _, c := range Cards {
		for _, side := range [2]Side{c.Front, c.Back} {
			if Enabled(side.Code) {
				enabled[side.Code] = true
				if side.Kind != KindFoot && side.Code != DrawAndCock {
					t.Errorf("enabled action %s is neither a foot action nor Draw & Cock", side.Code)
				}
			}
			if IsMove(side.Code) && side.Kind != KindFoot {
				t.Errorf("move action %s is not a foot action", side.Code)
			}
			if side.Choice.NeedsRel() != (side.Choice.IsAheadRel() || side.Choice.IsBackRel()) {
				t.Errorf("%s: NeedsRel inconsistent", side.Code)
			}
		}
	}
	if len(enabled) != 9 {
		t.Errorf("%d enabled actions, want 9: %v", len(enabled), enabled)
	}
	if !ChoiceGun.NeedsGun() || ChoiceMoveAhead.NeedsGun() || ChoiceGun.NeedsRel() {
		t.Error("NeedsGun")
	}
	for _, c := range []Code{Advance, BackUp, Run, Sprint} {
		if !IsMove(c) {
			t.Errorf("IsMove(%s) = false", c)
		}
	}
	for _, c := range []Code{Turn, SpinAround, LeapDrop, GetUpDown, Shoot} {
		if IsMove(c) {
			t.Errorf("IsMove(%s) = true", c)
		}
	}
}
