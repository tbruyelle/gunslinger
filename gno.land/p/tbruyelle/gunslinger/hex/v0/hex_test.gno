package hex

import "testing"

func TestDirStringOpposite(t *testing.T) {
	want := [6]string{"N", "NE", "SE", "S", "SW", "NW"}
	for d := Dir(0); d < 6; d++ {
		if got := d.String(); got != want[d] {
			t.Errorf("Dir(%d).String() = %q, want %q", d, got, want[d])
		}
		if got := d.Opposite().Opposite(); got != d {
			t.Errorf("Dir(%d).Opposite().Opposite() = %d", d, got)
		}
		if got := d.Opposite(); got != (d+3)%6 {
			t.Errorf("Dir(%d).Opposite() = %d", d, got)
		}
	}
	if Dir(6).Valid() || Dir(-1).Valid() {
		t.Error("out-of-range Dir reported valid")
	}
	if Dir(6).String() != "?" {
		t.Error("out-of-range Dir.String() should be ?")
	}
}

func TestParseRel(t *testing.T) {
	for _, s := range []string{"ahead_left", "ahead", "ahead_right", "back_left", "back", "back_right"} {
		r, ok := ParseRel(s)
		if !ok || string(r) != s {
			t.Errorf("ParseRel(%q) = %q, %v", s, r, ok)
		}
		if r.IsAhead() == r.IsBack() {
			t.Errorf("%q must be exactly one of ahead/back", s)
		}
	}
	// Same and Long are result-card values, not plan choices.
	for _, s := range []string{"", "north", "straight_ahead", "Ahead", "ahead ", string(Same), string(Long)} {
		if _, ok := ParseRel(s); ok {
			t.Errorf("ParseRel(%q) accepted", s)
		}
	}
	for _, r := range AheadRels {
		if !r.IsAhead() {
			t.Errorf("%q in AheadRels but !IsAhead", r)
		}
	}
	for _, r := range BackRels {
		if !r.IsBack() {
			t.Errorf("%q in BackRels but !IsBack", r)
		}
	}
}

// Left and right are the character's own sides while it keeps facing
// forward, so back_right is two clockwise steps from the facing. (This is the
// client's convention; bga/modules/php/Hex.php swaps back_left/back_right.)
func TestResolve(t *testing.T) {
	offsets := map[Rel]int{
		AheadLeft: 5, Ahead: 0, AheadRight: 1,
		BackRight: 2, Back: 3, BackLeft: 4,
	}
	for f := Dir(0); f < 6; f++ {
		for r, off := range offsets {
			want := Dir((int(f) + off) % 6)
			if got := Resolve(f, r); got != want {
				t.Errorf("Resolve(%s, %s) = %s, want %s", f, r, got, want)
			}
		}
	}
	// Facing north: ahead_left is NW, ahead is N, ahead_right is NE.
	if got := AheadDirs(N); got != [3]Dir{NW, N, NE} {
		t.Errorf("AheadDirs(N) = %v", got)
	}
	// Facing north: back_left is SW, back is S, back_right is SE.
	if got := BackDirs(N); got != [3]Dir{SW, S, SE} {
		t.Errorf("BackDirs(N) = %v", got)
	}
	if got := AheadDirs(S); got != [3]Dir{SE, S, SW} {
		t.Errorf("AheadDirs(S) = %v", got)
	}
}

func TestOffsetPanicsOnInvalidRel(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("Rel(\"x\").Offset() did not panic")
		}
	}()
	Rel("x").Offset()
}
