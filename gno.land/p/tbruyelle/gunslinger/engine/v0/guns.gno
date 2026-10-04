package engine

// GunType identifies a weapon model.
type GunType string

const (
	// NoGun marks an empty gun slot.
	NoGun GunType = ""
	// Colt45 is the one-handed six-shooter every character starts with.
	Colt45 GunType = "colt45"
)

// GunSpec is the static data of a gun model (rules section 11).
type GunSpec struct {
	Name      string
	Capacity  int
	OneHanded bool
}

// Spec returns the model's static data.
func (t GunType) Spec() GunSpec {
	switch t {
	case Colt45:
		return GunSpec{Name: "Colt 45", Capacity: 6, OneHanded: true}
	}
	return GunSpec{}
}

// GunLocation is where a character keeps a gun (the boxes of the sheet).
type GunLocation int

const (
	Holstered GunLocation = iota
	GunHand
	OtherHand
	BothHands
)

// String returns the location name used in JSON views.
func (l GunLocation) String() string {
	switch l {
	case Holstered:
		return "holstered"
	case GunHand:
		return "gun_hand"
	case OtherHand:
		return "other_hand"
	case BothHands:
		return "both_hands"
	}
	return "?"
}

// Gun is one weapon carried by a character.
type Gun struct {
	Type     GunType
	Location GunLocation
	Cocked   bool
	Shells   int
}

// MaxGuns is how many guns a character can carry (hands and holsters).
const MaxGuns = 3

// Guns is a character's weapons; empty slots have Type NoGun.
type Guns [MaxGuns]Gun

// Count is the number of guns carried.
func (g Guns) Count() int {
	n := 0
	for _, gun := range g {
		if gun.Type != NoGun {
			n++
		}
	}
	return n
}

// startingGuns is the fixed loadout at game creation: a loaded, uncocked
// Colt 45 in the holster.
func startingGuns() Guns {
	return Guns{{Type: Colt45, Location: Holstered, Cocked: false, Shells: 6}}
}
