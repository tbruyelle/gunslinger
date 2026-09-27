// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z3_err_not_a_player_filetest

package z3_err_not_a_player_filetest

import (
	"testing"

	gunslinger "gno.land/r/tbruyelle/gunslinger/v0"
)

const (
	alice address = "g1alice00000000000000000000000000000000"
	bob   address = "g1bob0000000000000000000000000000000000"
	carol address = "g1carol0000000000000000000000000000000"
)

func main(cur realm) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := gunslinger.CreateGame(cross(cur), "marshal", 10)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(carol))
	gunslinger.SubmitPlan(cross(cur), id, "1f:ahead")
}

// Error:
// gunslinger: you are not a player of this game
