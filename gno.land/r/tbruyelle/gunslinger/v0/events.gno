package gunslinger

import "chain"

// Events emitted by the realm (type, attribute keys):
//
//	GameCreated   id creator char maxTurns
//	PlayerJoined  id player char
//	PlanSubmitted id turn player seat
//	TurnResolved  id turn rev seed
//	GameEnded     id reason winner
//
// They land in transaction results; clients still poll Game.Rev to sync.
func emit(typ string, attrs ...string) {
	chain.Emit(typ, attrs...)
}
