// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z12_max_turns_finish_filetest

package z12_max_turns_finish_filetest

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
	id := gunslinger.CreateGame(cross(cur), "marshal", 1, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	gunslinger.SubmitPlan(cross(cur), id, "")
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.SubmitPlan(cross(cur), id, "3b:ahead_left")
	println(gunslinger.GameJSON(id))
}

// Output:
// {"id":"0000001","rev":4,"phase":"finished","turn":1,"maxTurns":1,"timeout":172800,"board":"A","players":[{"addr":"g1alice00000000000000000000000000000000","char":"marshal","hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false,"ranLastTurn":false,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6}]},{"addr":"g1bob0000000000000000000000000000000000","char":"dude","hex":"A-F9","facing":5,"down":false,"delay":0,"status":"alive","submitted":false,"playedFoot":false,"playedRun":false,"ranLastTurn":false,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6}]}],"winner":-1,"endReason":"max_turns","createdAt":1234567890,"updatedAt":1234567890,"timeoutAt":0,"lastTurn":{"turn":1,"seed":"50b68170af31c81ad569f3d15712988aa6034382e4fe581e6753aa6369a3442e","cards":[],"plans":["","3b:ahead_left"],"events":[{"seg":1,"p":1,"kind":"turn","action":"turn","from":"","to":"","facing":5,"down":false,"n":0,"delay":0,"reason":"","card":0,"result":"","gun":"","gunId":0}],"start":[{"hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6}]},{"hex":"A-F9","facing":0,"down":false,"delay":0,"status":"alive","guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6}]}]}}
