// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z8_timeout_claim_filetest

package z8_timeout_claim_filetest

import (
	"testing"

	gunslinger "gno.land/r/tbruyelle/gunslinger/v0"
)

const (
	alice address = "g1alice00000000000000000000000000000000"
	bob   address = "g1bob0000000000000000000000000000000000"
	carol address = "g1carol0000000000000000000000000000000"
)

// After 30 minutes without the second plan, anyone can end the game.
func main(cur realm) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := gunslinger.CreateGame(cross(cur), "marshal", 10)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	gunslinger.SubmitPlan(cross(cur), id, "1f:ahead")
	testing.SkipHeights(361) // 5s per height
	testing.SetRealm(testing.NewUserRealm(carol))
	gunslinger.ClaimTimeout(cross(cur), id)
	println(gunslinger.GameJSON(id))
}

// Output:
// {"id":"0000001","rev":4,"phase":"finished","turn":1,"maxTurns":10,"board":"A","players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal","hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","submitted":true,"playedFoot":true,"playedRun":false,"ranLastTurn":false},{"addr":"g1bob0000000000000000000000000000000000","char":"dude","hex":"A-F9","facing":0,"down":false,"delay":0,"status":"out","submitted":false,"playedFoot":false,"playedRun":false,"ranLastTurn":false}],"winner":0,"endReason":"timeout","createdAt":1234567890,"updatedAt":1234569695,"timeoutAt":0,"lastTurn":null}
