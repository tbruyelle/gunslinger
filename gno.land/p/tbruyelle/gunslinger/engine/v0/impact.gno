package engine

// PenaltyKind names the combat results of the IMPACT TABLE (rules 14.11,
// 14.12).
type PenaltyKind string

const (
	Kill      PenaltyKind = "kill"       // killed, out of the game
	Stun      PenaltyKind = "stun"       // draws N wound cards and loses aim
	Stagger   PenaltyKind = "stagger"    // thrown to a hex and facing drawn on two direction cards, then drops
	Serious   PenaltyKind = "serious"    // N fatigue cards at the start of every turn; may kill at the end
	DropGunHand   PenaltyKind = "gun_hand"   // the weapon in the gun hand drops in the hex
	GunArm    PenaltyKind = "gun_arm"    // -N aim time with the gun hand
	DropOtherHand PenaltyKind = "other_hand" // the weapon in the other hand drops in the hex
	OtherArm  PenaltyKind = "other_arm"  // -N aim time with the other hand
	LegWound  PenaltyKind = "leg"        // N fatigue cards per hex moved while upright
	Light     PenaltyKind = "light"      // draws N fatigue cards
)

// Penalty is one combat result, with its number when the kind takes one.
type Penalty struct {
	Kind PenaltyKind
	N    int
}

// Impact is the IMPACT TABLE: the penalties a hit location inflicts for a
// gun's table line (rule 13.8). Only line B, the Colt 45's, is transcribed
// (from the VASSAL module's table); other lines come with their guns.
func Impact(line byte, loc HitLoc) []Penalty {
	if line != 'B' {
		return nil
	}
	switch loc {
	case VitalHit, CritHit:
		return []Penalty{{Kill, 0}}
	case BodyHit:
		return []Penalty{{Stun, 4}, {Stagger, 0}, {Serious, 2}}
	case SideHit:
		return []Penalty{{Stun, 2}, {Stagger, 0}}
	case HeadHit:
		return []Penalty{{Stun, 8}}
	case GunHit:
		return []Penalty{{Stun, 4}, {DropGunHand, 0}, {Serious, 1}, {GunArm, 4}}
	case ArmHit:
		return []Penalty{{Stun, 3}, {DropOtherHand, 0}, {Serious, 1}, {OtherArm, 4}}
	case LegHit:
		return []Penalty{{Stun, 3}, {Stagger, 0}, {Serious, 2}, {LegWound, 4}}
	}
	return nil
}
