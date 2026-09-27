package engine

import (
	"strings"
	"testing"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

func mustPlan(t *testing.T, s string) Plan {
	t.Helper()
	p, err := ParsePlan(s)
	if err != nil {
		t.Fatalf("ParsePlan(%q): %v", s, err)
	}
	return p
}

func TestParsePlanRoundTrip(t *testing.T) {
	for _, s := range []string{
		"",
		"1f:ahead_left",
		"1f:ahead_left,2f:ahead,3f",
		"4b",
		"1b:back_right,3b:ahead",
		"12b",
		"5b,3b:ahead_right,4b",
	} {
		p := mustPlan(t, s)
		if got := p.String(); got != s {
			t.Errorf("ParsePlan(%q).String() = %q", s, got)
		}
	}
	p := mustPlan(t, "1f:ahead_left,2f:ahead,3f")
	want := Plan{
		{Card: 1, Side: 'f', Code: cards.Advance, Cost: 2, Dir: hex.AheadLeft},
		{Card: 2, Side: 'f', Code: cards.Run, Cost: 1, Dir: hex.Ahead},
		{Card: 3, Side: 'f', Code: cards.Sprint, Cost: 1},
	}
	if len(p) != len(want) {
		t.Fatalf("got %d actions", len(p))
	}
	for i := range want {
		if p[i] != want[i] {
			t.Errorf("action %d = %+v, want %+v", i, p[i], want[i])
		}
	}
	if p.Cost() != 4 {
		t.Errorf("Cost() = %d", p.Cost())
	}
	if !p.Has(cards.Run) || p.Has(cards.Turn) {
		t.Error("Has is wrong")
	}
	if !p.PlayedFoot() || mustPlan(t, "").PlayedFoot() {
		t.Error("PlayedFoot is wrong")
	}
}

func TestParsePlanRejects(t *testing.T) {
	for _, s := range []string{
		"13f", "0f", "-1f", "1x", "1F", "f", "1", "1f:", ":ahead",
		"1f:north", "1f:straight_ahead", "1f:Ahead",
		"1f,2f,3f,4f,5f,6f", // six entries
		"1f,", ",1f", "1f,,2f", "1f, 2f", " 1f", "1f ",
		"1f:ahead:ahead",
		strings.Repeat("1f,", 60),
	} {
		if p, err := ParsePlan(s); err == nil {
			t.Errorf("ParsePlan(%q) accepted: %v", s, p)
		}
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		plan  string
		delay int
		err   string // "" for a valid plan, else a substring of the error
	}{
		{"", 0, ""},
		{"1f:ahead,2f:ahead_left,3f", 0, ""},
		{"1b:back_left,3b:ahead", 0, ""},
		{"5b,3b:ahead_right,4b", 0, ""},
		{"2b:back,3b:ahead_left", 0, ""},
		{"1f:ahead,1b:back", 0, "both sides"},
		{"3f,3f", 0, "both sides"},
		{"1b:back,5b", 0, "more time points"},
		{"1f:ahead,3b:ahead,4b", 2, "more time points"},
		{"1f:ahead,3b:ahead", 2, ""},
		{"4b", 5, "more time points"},
		{"2f:ahead", 0, "together with advance"},
		{"1f:ahead,3f", 0, "together with run"},
		{"1f:ahead,2f:ahead,3f,4f", 0, ""},
		{"1f", 0, "forward direction"},
		{"1f:back", 0, "forward direction"},
		{"3b:back_left", 0, "forward direction"},
		{"1b:ahead", 0, "backward direction"},
		{"1b", 0, "backward direction"},
		{"2b:ahead_right", 0, "backward direction"},
		{"3f:ahead", 0, "takes no direction"},
		{"4b:back", 0, "takes no direction"},
		{"5f", 0, "not available"},
		{"7f", 0, "not available"},
		{"12b", 0, "not available"},
	}
	for _, tt := range tests {
		p := mustPlan(t, tt.plan)
		err := p.Validate(Character{Delay: tt.delay})
		switch {
		case tt.err == "" && err != nil:
			t.Errorf("Validate(%q, delay %d) = %v, want ok", tt.plan, tt.delay, err)
		case tt.err != "" && err == nil:
			t.Errorf("Validate(%q, delay %d) = ok, want %q", tt.plan, tt.delay, tt.err)
		case tt.err != "" && !strings.Contains(err.Error(), tt.err):
			t.Errorf("Validate(%q, delay %d) = %v, want %q", tt.plan, tt.delay, err, tt.err)
		}
	}
}
