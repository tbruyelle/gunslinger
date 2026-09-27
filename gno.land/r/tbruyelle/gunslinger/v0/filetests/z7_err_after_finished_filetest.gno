// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z7_err_after_finished_filetest

package z7_err_after_finished_filetest

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
	id := gunslinger.CreateGame(cross(cur), "marshal", 1)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	gunslinger.SubmitPlan(cross(cur), id, "")
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.SubmitPlan(cross(cur), id, "")
	gunslinger.SubmitPlan(cross(cur), id, "")
}

// Error:
// gunslinger: game is not accepting plans
