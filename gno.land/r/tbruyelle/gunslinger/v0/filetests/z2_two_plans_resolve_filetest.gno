// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z2_two_plans_resolve_filetest

package z2_two_plans_resolve_filetest

import (
	"testing"

	gunslinger "gno.land/r/tbruyelle/gunslinger/v0"
)

const (
	alice address = "g1alice00000000000000000000000000000000"
	bob   address = "g1bob0000000000000000000000000000000000"
	carol address = "g1carol0000000000000000000000000000000"
)

// The second plan of a turn resolves it: alice advances then runs, bob drops.
func main(cur realm) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := gunslinger.CreateGame(cross(cur), "marshal", 10)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	println(gunslinger.SubmitPlan(cross(cur), id, "1f:ahead,2f:ahead"))
	testing.SetRealm(testing.NewUserRealm(bob))
	println(gunslinger.SubmitPlan(cross(cur), id, "5b"))
	println(gunslinger.GameJSON(id))
}

// Output:
// 3
// 4
// {"id":"0000001","rev":4,"phase":"planning","turn":2,"maxTurns":10,"board":"A","players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal","hex":"A-F5","facing":3,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false},{"addr":"g1bob0000000000000000000000000000000000","char":"dude","hex":"A-F9","facing":0,"down":true,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false}],"winner":-1,"endReason":"","createdAt":1234567890,"updatedAt":1234567890,"timeoutAt":1234569690,"lastTurn":{"turn":1,"seed":"d96423c06fe59c80abd98e132c1d66fc85c61051eb7946c2b54ae0e07ddef7b3","plans":["1f:ahead,2f:ahead","5b"],"events":[{"seg":2,"p":0,"kind":"move","action":"advance","from":"A-F3","to":"A-F4","facing":3,"down":false,"n":0,"delay":0,"reason":""},{"seg":3,"p":0,"kind":"move","action":"run","from":"A-F4","to":"A-F5","facing":3,"down":false,"n":0,"delay":0,"reason":""},{"seg":3,"p":1,"kind":"flip","action":"get_up_down","from":"","to":"","facing":0,"down":true,"n":0,"delay":0,"reason":""}],"start":[{"hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive"},{"hex":"A-F9","facing":0,"down":false,"delay":0,"status":"alive"}]}}
