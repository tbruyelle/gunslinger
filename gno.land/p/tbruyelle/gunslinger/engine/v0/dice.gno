package engine

import (
	"crypto/sha256"
	"encoding/binary"
	"math/rand"
	"strings"
)

// Dice draws the result cards the rules call for. Only delay cards are
// needed by the foot engine.
type Dice interface {
	// DrawDelay returns the delay points of a drawn delay card.
	DrawDelay() int
}

// Fixed is a Dice that always draws the same value; tests use Fixed(1) to
// match the BGA reference engine's stub.
type Fixed int

// DrawDelay implements Dice.
func (f Fixed) DrawDelay() int { return int(f) }

// Seed hashes the given parts into dice seed material.
func Seed(parts ...string) [32]byte {
	return sha256.Sum256([]byte(strings.Join(parts, "|")))
}

type pcgDice struct {
	r *rand.Rand
}

// NewDice returns deterministic Dice for a seed: the same seed always draws
// the same sequence, so a resolution can be replayed from its stored seed.
func NewDice(seed [32]byte) Dice {
	s1 := binary.BigEndian.Uint64(seed[0:8])
	s2 := binary.BigEndian.Uint64(seed[8:16])
	return &pcgDice{r: rand.New(rand.NewPCG(s1, s2))}
}

// DrawDelay draws 1 to 3 delay points, a stand-in for the 108-card result
// deck until it is transcribed.
func (d *pcgDice) DrawDelay() int { return 1 + d.r.IntN(3) }
