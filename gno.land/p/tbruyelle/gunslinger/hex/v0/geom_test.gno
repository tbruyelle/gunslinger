package hex

import "testing"

func TestCoordsMatchNeighbors(t *testing.T) {
	// Every neighbour sits one direction step away in axial coordinates.
	for _, id := range A.IDs() {
		q, r, ok := A.Coords(id)
		if !ok {
			t.Fatalf("no coords for %s", id)
		}
		for d := Dir(0); d < 6; d++ {
			nb, ok := A.Neighbor(id, d)
			if !ok {
				continue
			}
			nq, nr, _ := A.Coords(nb)
			sq, sr := d.Step()
			if nq != q+sq || nr != r+sr {
				t.Errorf("%s -[%s]-> %s: (%d,%d) -> (%d,%d), step (%d,%d)", id, d, nb, q, r, nq, nr, sq, sr)
			}
		}
	}
	if _, _, ok := A.Coords("A-Z9"); ok {
		t.Error("unknown hex has coords")
	}
}

func TestDistance(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"A-F3", "A-F3", 0}, {"A-F3", "A-F4", 1}, {"A-F3", "A-F9", 6}, {"A-F3", "A-G4", 1},
		{"A-F3", "A-G5", 2}, {"A-F6", "A-E7", 1}, {"A-A1", "A-F3", 5},
	}
	for _, c := range cases {
		if got := A.Distance(c.a, c.b); got != c.want {
			t.Errorf("Distance(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
		if got := A.Distance(c.b, c.a); got != c.want {
			t.Errorf("Distance(%s, %s) = %d, want %d", c.b, c.a, got, c.want)
		}
	}
	if A.Distance("A-F3", "A-Z9") != -1 {
		t.Error("unknown hex should give -1")
	}
}

func TestInAimZone(t *testing.T) {
	// From F6 facing S: the cone between SE and SW. F6's neighbours:
	// N F5, NE G6, SE G7, S F7, SW E7, NW E6.
	in := []string{"A-F6", "A-F7", "A-G7", "A-E7", "A-F9", "A-G8", "A-E8", "A-H8", "A-D8"}
	out := []string{"A-F5", "A-G6", "A-E6", "A-F3", "A-H6", "A-D6"}
	for _, h := range in {
		if !A.InAimZone("A-F6", S, h) {
			t.Errorf("%s should be in the aim zone of F6 facing S", h)
		}
	}
	for _, h := range out {
		if A.InAimZone("A-F6", S, h) {
			t.Errorf("%s should be in the blind zone of F6 facing S", h)
		}
	}
	// Facing N from F9: F3 is straight ahead, F12 behind.
	if !A.InAimZone("A-F9", N, "A-F3") || A.InAimZone("A-F9", N, "A-F12") {
		t.Error("F9 facing N")
	}
	// Facing NE from F6: the cone between N and SE; G6 (NE) is in, E7 (SW) out, F5 (N) on the edge is in.
	if !A.InAimZone("A-F6", NE, "A-G6") || !A.InAimZone("A-F6", NE, "A-F5") || A.InAimZone("A-F6", NE, "A-E7") {
		t.Error("F6 facing NE")
	}
}

func TestLongDir(t *testing.T) {
	// Shooter F3, target F6: the line runs south, the Long hex is F7.
	if d := A.LongDir("A-F3", "A-F6", N); d != S {
		t.Errorf("F3 -> F6 long dir = %s", d)
	}
	// Target NE of the shooter.
	if d := A.LongDir("A-F6", "A-G6", N); d != NE {
		t.Errorf("F6 -> G6 long dir = %s", d)
	}
	// Same hex: the shooter's facing.
	if d := A.LongDir("A-F6", "A-F6", SW); d != SW {
		t.Errorf("same hex long dir = %s", d)
	}
	// Off-axis: F6 -> G5 is two steps (NE then N); the line leans between N and NE.
	if d := A.LongDir("A-F6", "A-G5", S); d != N && d != NE {
		t.Errorf("F6 -> G5 long dir = %s", d)
	}
}
