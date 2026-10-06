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

func TestFireCharts(t *testing.T) {
	for _, c := range Cards {
		if c.N <= 100 {
			if c.Fire == nil || c.Malf != nil || len(c.Fire.Rows) == 0 || c.Fire.Lesser() == Miss {
				t.Errorf("card %d: not a FIRE card: %+v", c.N, c)
			}
		} else if c.Fire != nil || c.Malf == nil {
			t.Errorf("card %d: not a MALFUNCTION card", c.N)
		}
	}
	// Card 1: ranges 0, 1-5, 6-12+; aim 2-5 BE/-/-, 6-8 BE/SIDE/-, 9+ BE/BE/SIDE.
	c := Card(1)
	for _, w := range []struct {
		aim, rng int
		hit      HitLoc
	}{{2, 0, Bullseye}, {1, 0, Miss}, {5, 3, Miss}, {6, 3, SideHit}, {8, 5, SideHit}, {8, 6, Miss}, {9, 6, SideHit}, {12, 20, SideHit}, {9, 1, Bullseye}} {
		if got := c.Fire.Lookup(w.aim, w.rng); got != w.hit {
			t.Errorf("card 1 aim %d range %d = %s, want %s", w.aim, w.rng, got, w.hit)
		}
	}
	if c.Status != "H" || c.Fire.Lesser() != SideHit {
		t.Errorf("card 1 status %q lesser %s", c.Status, c.Fire.Lesser())
	}
	// Card 15: aim 8-9 only; 10 misses. Card 27: three rows, Run status.
	if Card(15).Fire.Lookup(10, 3) != Miss || Card(15).Fire.Lookup(9, 3) != SideHit {
		t.Error("card 15")
	}
	if Card(27).Fire.Lookup(1, 2) != BodyHit || Card(27).Fire.Lookup(5, 5) != Bullseye || Card(27).Status != "R" {
		t.Error("card 27")
	}
	if Card(100).Status != "RDH" || Card(96).Status != "MDH" || Card(45).Status != "DH" {
		t.Errorf("statuses: %q %q %q", Card(100).Status, Card(96).Status, Card(45).Status)
	}
	// Malfunction blocks.
	if m := Card(101).Malf; m.Handloaded || !m.CapAndBall || m.Second != GunJams {
		t.Errorf("card 101 = %+v", m)
	}
	if m := Card(105).Malf; !m.Handloaded || !m.Storebought || m.Second != GunJams {
		t.Errorf("card 105 = %+v", m)
	}
	if m := Card(108).Malf; !m.Handloaded || m.Storebought || m.Second != GunExplodes {
		t.Errorf("card 108 = %+v", m)
	}
	// Impact line B.
	if p := Impact('B', VitalHit); len(p) != 1 || p[0].Kind != Kill {
		t.Errorf("vital = %v", p)
	}
	if p := Impact('B', LegHit); len(p) != 4 || p[3].Kind != LegWound || p[3].N != 4 {
		t.Errorf("leg = %v", p)
	}
	if Impact('C', VitalHit) != nil {
		t.Error("line C is not transcribed")
	}
}
