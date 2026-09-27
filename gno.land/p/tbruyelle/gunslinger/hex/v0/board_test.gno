package hex

import (
	"sort"
	"testing"
)

func TestBoardAIntegrity(t *testing.T) {
	if A.Name() != "A" {
		t.Errorf("name = %q", A.Name())
	}
	if A.Size() != 137 {
		t.Fatalf("board A has %d hexes, want 137", A.Size())
	}
	ids := A.IDs()
	if !sort.StringsAreSorted(ids) {
		t.Fatal("ids are not sorted")
	}
	for i := 1; i < len(ids); i++ {
		if ids[i] == ids[i-1] {
			t.Errorf("duplicate id %q", ids[i])
		}
	}
	if len(A.nbr) != len(ids) {
		t.Fatalf("nbr has %d rows, want %d", len(A.nbr), len(ids))
	}
	for _, id := range ids {
		if A.Index(id) < 0 || !A.Has(id) {
			t.Errorf("%q not found by Index/Has", id)
		}
		n := 0
		for d := Dir(0); d < 6; d++ {
			nb, ok := A.Neighbor(id, d)
			if !ok {
				continue
			}
			n++
			if nb == id {
				t.Errorf("%s is its own %s neighbour", id, d)
			}
			// Adjacency is symmetric: going back the opposite way returns.
			back, ok := A.Neighbor(nb, d.Opposite())
			if !ok || back != id {
				t.Errorf("asymmetric: %s -%s-> %s but %s -%s-> %q", id, d, nb, nb, d.Opposite(), back)
			}
		}
		if n < 1 || n > 6 {
			t.Errorf("%s has %d neighbours", id, n)
		}
	}
}

func TestBoardANeighbors(t *testing.T) {
	// A central hex has a full ring (same sample as scripts/gen_board_data.py).
	if got := A.Neighbors("A-F6"); got != [6]string{"A-F5", "A-G6", "A-G7", "A-F7", "A-E7", "A-E6"} {
		t.Errorf("Neighbors(A-F6) = %v", got)
	}
	// The two starting hexes of the fixed 2-player setup.
	if nb, ok := A.Neighbor("A-F1", S); !ok || nb != "A-F2" {
		t.Errorf("Neighbor(A-F1, S) = %q, %v", nb, ok)
	}
	if nb, ok := A.Neighbor("A-F12", N); !ok || nb != "A-F11" {
		t.Errorf("Neighbor(A-F12, N) = %q, %v", nb, ok)
	}
	// A-F12 sits on the bottom edge: nothing to the south.
	if _, ok := A.Neighbor("A-F12", S); ok {
		t.Error("Neighbor(A-F12, S) should be off-board")
	}
	// Unknown hex or invalid direction.
	if _, ok := A.Neighbor("A-Z9", N); ok {
		t.Error("unknown hex should have no neighbour")
	}
	if _, ok := A.Neighbor("A-F6", Dir(6)); ok {
		t.Error("invalid direction should have no neighbour")
	}
	if got := A.Neighbors("A-Z9"); got != [6]string{} {
		t.Errorf("Neighbors(unknown) = %v", got)
	}
	if A.Index("A-Z9") != -1 || A.Has("") {
		t.Error("unknown ids must not be found")
	}
	// IDs returns a copy.
	ids := A.IDs()
	ids[0] = "mutated"
	if A.IDs()[0] == "mutated" {
		t.Error("IDs() must return a copy")
	}
}
