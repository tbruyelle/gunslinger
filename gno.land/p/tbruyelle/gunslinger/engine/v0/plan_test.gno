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
		"9f:1:0",
		"9f:12:2",
	} {
		p := mustPlan(t, s)
		if got := p.String(); got != s {
			t.Errorf("ParsePlan(%q).String() = %q", s, got)
		}
	}
	p := mustPlan(t, "1f:ahead_left,2f:ahead,3f")
	want := Plan{
		{Card: 1, Side: 'f', Code: cards.Advance, Cost: 2, Dir: hex.AheadLeft, Hand: -1},
		{Card: 2, Side: 'f', Code: cards.Run, Cost: 1, Dir: hex.Ahead, Hand: -1},
		{Card: 3, Side: 'f', Code: cards.Sprint, Cost: 1, Hand: -1},
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
		"1f:ahead:ahead", "9f:1", "9f:0:0", "9f:-1:0", "9f:ahead", "1f:0", "9f:1:3", "9f:1:x", "9f:1:0:0",
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
		{"9f", 0, "choose the gun"},
		{"9f:2:0", 0, "not in a holster"},
		{"9f:1:1", 0, "only the gun hand"},
		{"9f:1:2", 0, "only the gun hand"},
		{"9f:1:0", 0, ""},
		{"1f:ahead,9f:1:0", 0, ""},
	}
	for _, tt := range tests {
		p := mustPlan(t, tt.plan)
		err := p.Validate(Character{Delay: tt.delay, RanLastTurn: true, Guns: startingGuns()})
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

func TestValidateSprintNeedsRunOnPreviousTurn(t *testing.T) {
	fresh := Character{}
	if err := mustPlan(t, "1f:ahead,2f:ahead,3f").Validate(fresh); err == nil || !strings.Contains(err.Error(), "previous turn") {
		t.Errorf("sprint without a run last turn: %v", err)
	}
	if err := mustPlan(t, "1f:ahead,2f:ahead").Validate(fresh); err != nil {
		t.Errorf("run without sprint should be fine: %v", err)
	}
	if err := mustPlan(t, "1f:ahead,2f:ahead,3f,4f").Validate(Character{RanLastTurn: true}); err != nil {
		t.Errorf("sprint after a run last turn: %v", err)
	}
	// The missing-run-this-turn message comes first.
	if err := mustPlan(t, "1f:ahead,3f").Validate(fresh); err == nil || !strings.Contains(err.Error(), "together with run") {
		t.Errorf("sprint without run this turn: %v", err)
	}
}

func TestDrawAndCockPlan(t *testing.T) {
	p := mustPlan(t, "9f:1:0")
	if p[0].Gun != 1 || p[0].Hand != HandGun || p[0].Dir != "" || p.String() != "9f:1:0" {
		t.Errorf("parsed %+v, string %q", p[0], p.String())
	}
	if d := mustPlan(t, "1f:ahead")[0]; d.Gun != 0 || d.Hand != -1 {
		t.Error("direction entries have no gun")
	}
	// Nothing to draw once the gun is already in hand.
	c := Character{Guns: startingGuns()}
	c.Guns[0].Location = GunHand
	if err := p.Validate(c); err == nil || !strings.Contains(err.Error(), "not in a holster") {
		t.Errorf("drawing a gun already in hand: %v", err)
	}
	// A second holstered gun cannot be drawn while the hand is busy.
	c.Guns[1] = Gun{ID: c.Guns.NextID(), Type: Colt45, Location: Holstered, Shells: 6}
	if c.Guns[1].ID != 2 || c.Guns.Find(2) != 1 || c.Guns.Find(9) != -1 {
		t.Errorf("ids: %+v", c.Guns)
	}
	if err := mustPlan(t, "9f:2:0").Validate(c); err == nil || !strings.Contains(err.Error(), "already holds") {
		t.Errorf("drawing with a full hand: %v", err)
	}
	// A direction card given a slot token is a parse error.
	if _, err := ParsePlan("3b:0"); err == nil || !strings.Contains(err.Error(), "invalid direction") {
		t.Errorf("expected a parse error: %v", err)
	}
}
