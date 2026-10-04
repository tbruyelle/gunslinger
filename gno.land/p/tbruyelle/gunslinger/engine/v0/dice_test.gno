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

func TestStartingGuns(t *testing.T) {
	for i, c := range NewState().Chars {
		if c.Guns.Count() != 1 {
			t.Fatalf("char %d carries %d guns", i, c.Guns.Count())
		}
		g := c.Guns[0]
		if g.ID != 1 || g.Type != Colt45 || g.Location != Holstered || g.Cocked || g.Shells != 6 {
			t.Errorf("char %d gun = %+v", i, g)
		}
	}
	if Colt45.Spec().Capacity != 6 || Colt45.Spec().Name != "Colt 45" || !Colt45.Spec().OneHanded {
		t.Error("Colt 45 spec")
	}
	if Holstered.String() != "holstered" || GunHand.String() != "gun_hand" || NoGun.Spec().Capacity != 0 {
		t.Error("gun names")
	}
	for code, want := range map[int]GunLocation{HandGun: GunHand, HandOther: OtherHand, HandBoth: BothHands} {
		if loc, ok := HandLocation(code); !ok || loc != want {
			t.Errorf("HandLocation(%d) = %v, %v", code, loc, ok)
		}
	}
	if _, ok := HandLocation(3); ok {
		t.Error("HandLocation(3) should be invalid")
	}
}
