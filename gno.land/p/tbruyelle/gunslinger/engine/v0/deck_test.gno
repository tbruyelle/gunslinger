package engine

import (
	"testing"

	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

func TestResultCards(t *testing.T) {
	for i, c := range Cards {
		if c.N != i+1 {
			t.Fatalf("card %d is numbered %d", i+1, c.N)
		}
		if c.Hex == "" {
			t.Errorf("card %d has no HEX line", c.N)
		}
	}
	// Spot checks against the card images.
	checks := []struct {
		n            int
		delay, wound Result
		rel          hex.Rel
	}{
		{1, 0, 0, hex.Same}, {18, 0, 0, hex.Same}, {19, 0, 1, hex.Long}, {37, 1, 2, hex.Long},
		{54, 1, 2, hex.Long}, {55, 1, 3, hex.AheadLeft}, {61, 2, 3, hex.Same}, {78, 2, 4, hex.Long},
		{79, 2, 5, hex.AheadRight}, {87, 2, 6, hex.Ahead}, {88, LoseAim, 1, hex.BackRight},
		{99, LoseAim, WildShot, hex.BackLeft}, {100, WildShot, Drop, hex.Back},
		{101, WildShot, Drop, hex.Back}, {106, 1, Drop, hex.Ahead}, {108, Drop, Drop, hex.Back},
	}
	for _, w := range checks {
		c := Card(w.n)
		if c.Delay != w.delay || c.Wound != w.wound || c.Hex != w.rel {
			t.Errorf("card %d = %+v, want delay %d wound %d hex %s", w.n, c, w.delay, w.wound, w.rel)
		}
	}
	// Delay line distribution: 36 zeros, 27 ones, 27 twos, 12 LOSE AIM, 4 WILD SHOT, 2 DROP.
	count := map[Result]int{}
	for _, c := range Cards {
		count[c.Delay]++
	}
	want := map[Result]int{0: 36, 1: 27, 2: 27, LoseAim: 12, WildShot: 4, Drop: 2}
	for r, n := range want {
		if count[r] != n {
			t.Errorf("%d cards with DELAY %v, want %d", count[r], r, n)
		}
	}
	if LoseAim.String() != "lose_aim" || WildShot.String() != "wild_shot" || Drop.String() != "drop" ||
		Result(2).String() != "" || !Result(0).IsPoints() || Drop.IsPoints() {
		t.Error("Result names")
	}
}

func TestDeckDeterministic(t *testing.T) {
	seed := Seed("gno.land/r/x", "0000001", "1", "1f:ahead", "", "42", "1700000000")
	a, b := NewDeck(seed), NewDeck(seed)
	seen := map[int]bool{}
	for i := 0; i < DeckSize; i++ {
		x, y := a.Draw(), b.Draw()
		if x.N != y.N {
			t.Fatalf("draw %d differs: %d vs %d", i, x.N, y.N)
		}
		if seen[x.N] {
			t.Fatalf("card %d dealt twice in one pass", x.N)
		}
		seen[x.N] = true
	}
	if len(seen) != DeckSize {
		t.Fatalf("%d distinct cards dealt", len(seen))
	}
	if a.Order() != b.Order() {
		t.Error("same seed, different order")
	}
	drawn := a.Drawn()
	if len(drawn) != DeckSize || drawn[0] != a.Order()[0] || drawn[DeckSize-1] != a.Order()[DeckSize-1] {
		t.Errorf("drawn = %v", drawn)
	}
	// The deck is reshuffled once exhausted and keeps dealing.
	if c := a.Draw(); c.N < 1 || c.N > DeckSize || len(a.Drawn()) != DeckSize+1 || a.Drawn()[DeckSize] != c.N {
		t.Errorf("draw after exhaustion = %+v, drawn %d", c, len(a.Drawn()))
	}
	if d := NewDeck(seed); len(d.Drawn()) != 0 {
		t.Errorf("fresh deck has drawn %v", d.Drawn())
	}
	if a.Order() == b.Order() {
		t.Error("the exhausted deck was not reshuffled")
	}

	other := NewDeck(Seed("gno.land/r/x", "0000001", "1", "1f:ahead_left", "", "42", "1700000000"))
	if other.Order() == NewDeck(seed).Order() {
		t.Error("different seeds produced the same shuffle")
	}
	if Seed("a") == Seed("b") {
		t.Error("Seed collision")
	}
}

func TestTestDrawers(t *testing.T) {
	if Fixed(37).Draw().N != 37 || Fixed(37).Draw().Delay != 1 {
		t.Error("Fixed")
	}
	s := Sequence{100, 1, 61}
	got := []int{s.Draw().N, s.Draw().N, s.Draw().N, s.Draw().N}
	if got[0] != 100 || got[1] != 1 || got[2] != 61 || got[3] != 61 {
		t.Errorf("Sequence dealt %v", got)
	}
}
