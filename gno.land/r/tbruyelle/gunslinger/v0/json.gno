package gunslinger

import (
	"strconv"
	"strings"

	"gno.land/p/tbruyelle/gunslinger/engine/v0"
)

// JSON views for the web client, read through Render("json/...") so the
// string comes back raw from vm/qrender. Built by hand: the shapes are fixed
// and small, and the chain has no encoding/json.

const listLimit = 50

// GameJSON is the full view of a game:
//
//	{"id","rev","phase","turn","maxTurns","board",
//	 "players":[{"addr","char","hex","facing","down","delay","status","submitted","playedFoot","playedRun"}],
//	 "winner","endReason","createdAt","updatedAt","timeoutAt",
//	 "lastTurn":null|{"turn","seed","plans":[..],"events":[{"seg","p","kind","action","from","to","facing","down","n","delay","reason"}],
//	             "start":[{"hex","facing","down","delay","status"},..]}}
//
// Times are unix seconds; winner and events[].p are seat indexes, -1 for none.
// The plans of the turn in progress are not exposed, only the submitted flags.
func GameJSON(id string) string {
	g := getGame(id)
	var b strings.Builder
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"rev":` + strconv.Itoa(g.Rev))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"maxTurns":` + strconv.Itoa(g.MaxTurns))
	b.WriteString(`,"board":"A"`)
	b.WriteString(`,"players":[`)
	for i := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		writePlayer(&b, g, i)
	}
	b.WriteString(`],"winner":` + strconv.Itoa(g.Winner))
	b.WriteString(`,"endReason":` + quote(g.EndReason))
	b.WriteString(`,"createdAt":` + strconv.FormatInt(g.CreatedAt.Unix(), 10))
	b.WriteString(`,"updatedAt":` + strconv.FormatInt(g.UpdatedAt.Unix(), 10))
	timeoutAt := int64(0)
	if g.Phase != PhaseFinished {
		timeoutAt = g.timeoutAt().Unix()
	}
	b.WriteString(`,"timeoutAt":` + strconv.FormatInt(timeoutAt, 10))
	b.WriteString(`,"lastTurn":`)
	writeTurnResult(&b, g.lastTurn())
	b.WriteByte('}')
	return b.String()
}

// HistoryJSON is every resolved turn of a game, oldest first, for replays:
//
//	{"id","turn","phase","players":[{"addr","char"}],"turns":[turn result...]}
func HistoryJSON(id string) string {
	g := getGame(id)
	var b strings.Builder
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"players":[`)
	for i, p := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"addr":` + quote(p.Addr.String()) + `,"char":` + quote(p.Char) + `}`)
	}
	b.WriteString(`],"turns":[`)
	for i, r := range g.Turns {
		if i > 0 {
			b.WriteByte(',')
		}
		writeTurnResult(&b, r)
	}
	b.WriteString("]}")
	return b.String()
}

func writePlayer(b *strings.Builder, g *Game, i int) {
	p, c := g.Players[i], g.State.Chars[i]
	b.WriteString(`{"addr":` + quote(p.Addr.String()))
	b.WriteString(`,"char":` + quote(p.Char))
	b.WriteString(`,"hex":` + quote(c.Hex))
	b.WriteString(`,"facing":` + strconv.Itoa(int(c.Facing)))
	b.WriteString(`,"down":` + strconv.FormatBool(c.Down))
	b.WriteString(`,"delay":` + strconv.Itoa(c.Delay))
	b.WriteString(`,"status":` + quote(c.Status.String()))
	b.WriteString(`,"submitted":` + strconv.FormatBool(g.Submitted[i]))
	b.WriteString(`,"playedFoot":` + strconv.FormatBool(c.PlayedFoot))
	b.WriteString(`,"playedRun":` + strconv.FormatBool(c.PlayedRun))
	b.WriteByte('}')
}

func writeTurnResult(b *strings.Builder, r *TurnResult) {
	if r == nil {
		b.WriteString("null")
		return
	}
	b.WriteString(`{"turn":` + strconv.Itoa(r.Turn))
	b.WriteString(`,"seed":` + quote(r.Seed))
	b.WriteString(`,"plans":[`)
	for i, p := range r.Plans {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(quote(p))
	}
	b.WriteString(`],"events":[`)
	for i, e := range r.Events {
		if i > 0 {
			b.WriteByte(',')
		}
		writeEvent(b, e)
	}
	b.WriteString(`],"start":[`)
	for i, c := range r.Start {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"hex":` + quote(c.Hex))
		b.WriteString(`,"facing":` + strconv.Itoa(int(c.Facing)))
		b.WriteString(`,"down":` + strconv.FormatBool(c.Down))
		b.WriteString(`,"delay":` + strconv.Itoa(c.Delay))
		b.WriteString(`,"status":` + quote(c.Status.String()))
		b.WriteByte('}')
	}
	b.WriteString("]}")
}

func writeEvent(b *strings.Builder, e engine.Event) {
	b.WriteString(`{"seg":` + strconv.Itoa(e.Seg))
	b.WriteString(`,"p":` + strconv.Itoa(e.Player))
	b.WriteString(`,"kind":` + quote(e.Kind))
	b.WriteString(`,"action":` + quote(string(e.Action)))
	b.WriteString(`,"from":` + quote(e.From))
	b.WriteString(`,"to":` + quote(e.To))
	b.WriteString(`,"facing":` + strconv.Itoa(int(e.Facing)))
	b.WriteString(`,"down":` + strconv.FormatBool(e.Down))
	b.WriteString(`,"n":` + strconv.Itoa(e.N))
	b.WriteString(`,"delay":` + strconv.Itoa(e.Delay))
	b.WriteString(`,"reason":` + quote(e.Reason))
	b.WriteByte('}')
}

// GamesJSON lists, for an address, the games waiting for an opponent and
// the games it plays or played, newest first (at most 50 each):
//
//	{"open":[summary...],"mine":[summary...]}
//	summary = {"id","rev","phase","turn","maxTurns","winner","endReason","createdAt","updatedAt","players":[{"addr","char"}]}
func GamesJSON(addr string) string {
	var b strings.Builder
	b.WriteString(`{"open":[`)
	n := 0
	openGames.ReverseIterate("", "", func(_ string, v any) bool {
		if n > 0 {
			b.WriteByte(',')
		}
		writeSummary(&b, v.(*Game))
		n++
		return n >= listLimit
	})
	b.WriteString(`],"mine":[`)
	if v := byPlayer.Get(addr); v != nil {
		for i, id := range v.([]string) {
			if i >= listLimit {
				break
			}
			if i > 0 {
				b.WriteByte(',')
			}
			writeSummary(&b, games.Get(id).(*Game))
		}
	}
	b.WriteString("]}")
	return b.String()
}

func writeSummary(b *strings.Builder, g *Game) {
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"rev":` + strconv.Itoa(g.Rev))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"maxTurns":` + strconv.Itoa(g.MaxTurns))
	b.WriteString(`,"winner":` + strconv.Itoa(g.Winner))
	b.WriteString(`,"endReason":` + quote(g.EndReason))
	b.WriteString(`,"createdAt":` + strconv.FormatInt(g.CreatedAt.Unix(), 10))
	b.WriteString(`,"updatedAt":` + strconv.FormatInt(g.UpdatedAt.Unix(), 10))
	b.WriteString(`,"players":[`)
	for i, p := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"addr":` + quote(p.Addr.String()) + `,"char":` + quote(p.Char) + `}`)
	}
	b.WriteString("]}")
}

// quote encodes s as a JSON string.
func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"' || c == '\\':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c == '\n':
			b.WriteString(`\n`)
		case c == '\r':
			b.WriteString(`\r`)
		case c == '\t':
			b.WriteString(`\t`)
		case c < 0x20:
			b.WriteString(`\u00`)
			b.WriteByte("0123456789abcdef"[c>>4])
			b.WriteByte("0123456789abcdef"[c&0xf])
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// GameRev is the cheapest way to poll a game for changes.
func GameRev(id string) int { return getGame(id).Rev }
