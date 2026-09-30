// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z1_create_join_filetest

package z1_create_join_filetest

import (
	"testing"

	gunslinger "gno.land/r/tbruyelle/gunslinger/v0"
)

const (
	alice address = "g1alice00000000000000000000000000000000"
	bob   address = "g1bob0000000000000000000000000000000000"
	carol address = "g1carol0000000000000000000000000000000"
)

// A game is created, then joined: the JSON view and the events.
func main(cur realm) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := gunslinger.CreateGame(cross(cur), "marshal", 10)
	println(gunslinger.GameJSON(id))
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	println(gunslinger.GameJSON(id))
	println(gunslinger.GamesJSON(bob.String()))
}

// Output:
// {"id":"0000001","rev":1,"phase":"waiting","turn":1,"maxTurns":10,"board":"A","players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal","hex":"A-F1","facing":3,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false},{"addr":"","char":"","hex":"A-F12","facing":0,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false}],"winner":-1,"endReason":"","createdAt":1234567890,"updatedAt":1234567890,"timeoutAt":1234569690,"lastTurn":null}
// {"id":"0000001","rev":2,"phase":"planning","turn":1,"maxTurns":10,"board":"A","players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal","hex":"A-F1","facing":3,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false},{"addr":"g1bob0000000000000000000000000000000000","char":"dude","hex":"A-F12","facing":0,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false}],"winner":-1,"endReason":"","createdAt":1234567890,"updatedAt":1234567890,"timeoutAt":1234569690,"lastTurn":null}
// {"open":[],"mine":[{"id":"0000001","rev":2,"phase":"planning","turn":1,"maxTurns":10,"winner":-1,"endReason":"","createdAt":1234567890,"updatedAt":1234567890,"players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal"},{"addr":"g1bob0000000000000000000000000000000000","char":"dude"}]}]}
