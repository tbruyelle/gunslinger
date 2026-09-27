package engine

import "testing"

func TestDiceDeterministic(t *testing.T) {
	seed := Seed("gno.land/r/x", "0000001", "1", "1f:ahead", "", "42", "1700000000")
	a, b := NewDice(seed), NewDice(seed)
	for i := 0; i < 20; i++ {
		x, y := a.DrawDelay(), b.DrawDelay()
		if x != y {
			t.Fatalf("draw %d differs: %d vs %d", i, x, y)
		}
		if x < 1 || x > 3 {
			t.Fatalf("draw %d out of range: %d", i, x)
		}
	}
	other := NewDice(Seed("gno.land/r/x", "0000001", "1", "1f:ahead_left", "", "42", "1700000000"))
	c := NewDice(seed)
	same := true
	for i := 0; i < 20; i++ {
		if other.DrawDelay() != c.DrawDelay() {
			same = false
		}
	}
	if same {
		t.Error("different seeds produced the same 20 draws")
	}
	if Seed("a") == Seed("b") {
		t.Error("Seed collision")
	}
	if Fixed(3).DrawDelay() != 3 {
		t.Error("Fixed")
	}
}

func TestCharKeys(t *testing.T) {
	if len(CharKeys) != 48 {
		t.Errorf("%d character keys", len(CharKeys))
	}
	if !IsCharKey("marshal") || !IsCharKey("dude") || IsCharKey("") || IsCharKey("Marshal") {
		t.Error("IsCharKey")
	}
}
