package engine

import (
	"testing"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

func TestEncodeEventsRoundTrip(t *testing.T) {
	evs := []Event{
		{Seg: 2, Player: 0, Kind: EvMove, Action: cards.Advance, From: "A-F3", To: "A-F4", Facing: hex.S, Down: false, Step: StepAction},
		{Seg: 3, Player: 1, Kind: EvDelay, N: 2, Delay: 5, Reason: ReasonStun, Card: 67, Endurance: 2, Step: StepEnd},
		{Seg: 3, Player: 1, Kind: EvDelay, Reason: ReasonDrop, Card: 97, Result: "lose_aim", Delay: 5},
		{Seg: 4, Player: 0, Kind: EvShot, Action: cards.Shoot, Card: 34, Target: 1, To: "A-F9", Hit: "BODY", Range: 2, N: 7, Gun: Colt45, GunID: 1, Step: StepShots},
		{Seg: 4, Player: 0, Kind: EvShot, Action: cards.Shoot, Card: 6, Target: -1, To: "A-F6", Hit: string(Miss), Reason: ReasonEmptyHex, Range: 3, N: 1, Gun: Colt45, GunID: 1},
		{Seg: 5, Player: 1, Kind: EvDraw, Action: cards.DrawAndCock, From: "ground", To: "gun_hand", Gun: Colt45, GunID: 2, N: 3},
		{Seg: EndOfTurn, Player: 0, Kind: EvCancel, Action: cards.Turn, Reason: ReasonTime},
		{Seg: 1, Player: 1, Kind: EvFlip, Down: true},
	}
	enc := EncodeEvents(evs)
	got := DecodeEvents(enc)
	if len(got) != len(evs) {
		t.Fatalf("decoded %d events, want %d: %q", len(got), len(evs), enc)
	}
	for i := range evs {
		if got[i] != evs[i] {
			t.Errorf("event %d: got %+v, want %+v", i, got[i], evs[i])
		}
	}
	// Turns recorded before events had a step decode with none.
	old := DecodeEvents("2|0|move|advance|A-F3|A-F4|3|0|0|0||0||0|0||0||0")
	if len(old) != 1 || old[0].To != "A-F4" || old[0].Step != 0 {
		t.Errorf("19-field record: got %+v", old)
	}
	if DecodeEvents("") != nil || len(DecodeEvents("garbage")) != 0 {
		t.Error("empty or malformed input should decode to nothing")
	}
	if len(enc) > 60*len(evs) {
		t.Errorf("encoding is %d bytes for %d events", len(enc), len(evs))
	}
}

func TestEncodeCharactersRoundTrip(t *testing.T) {
	st := NewState()
	st.Chars[0].Hex, st.Chars[0].Facing, st.Chars[0].Down, st.Chars[0].Delay = "A-G5", hex.SW, true, 3
	st.Chars[0].Status, st.Chars[0].PlayedFoot, st.Chars[0].PlayedRun, st.Chars[0].RanLastTurn, st.Chars[0].Dropped = Killed, true, true, true, true
	st.Chars[0].Aim, st.Chars[0].AimHex, st.Chars[0].Endurance, st.Chars[0].Exhausted = 4, "A-F6", 11, 1
	st.Chars[0].Serious, st.Chars[0].GunArm, st.Chars[0].OtherArm, st.Chars[0].Leg = 2, 4, 1, 3
	st.Chars[0].Guns = Guns{{ID: 1, Type: Colt45, Location: GunHand, Cocked: true, Shells: 4, Jammed: true}, {ID: 3, Type: Colt45, Location: Holstered, Shells: 6, Exploded: true}}
	st.Chars[1].Guns = Guns{} // no gun at all
	got := DecodeChars(EncodeChars(st.Chars))
	for i := range st.Chars {
		if got[i] != st.Chars[i] {
			t.Errorf("char %d: got %+v, want %+v", i, got[i], st.Chars[i])
		}
	}
	if DecodeCharacter("bad") != (Character{}) {
		t.Error("malformed character should decode to zero")
	}
}

func TestEncodeIntsRoundTrip(t *testing.T) {
	for _, ns := range [][]int{nil, {44}, {44, 1, 30, 108}} {
		got := DecodeInts(EncodeInts(ns))
		if len(got) != len(ns) {
			t.Fatalf("%v -> %v", ns, got)
		}
		for i := range ns {
			if got[i] != ns[i] {
				t.Errorf("%v -> %v", ns, got)
			}
		}
	}
}
