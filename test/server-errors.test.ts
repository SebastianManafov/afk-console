import assert from "node:assert/strict";
import test from "node:test";
import { httpStatusForError } from "../src/server.js";

test("API-Fehler erhalten passende HTTP-Statuscodes", () => {
  assert.equal(httpStatusForError(new Error("Ungültige Serveradresse")), 400);
  assert.equal(httpStatusForError(new Error("Bot ist nicht online")), 409);
  assert.equal(httpStatusForError(new Error("Mehrere Accounts sind online; accountId ist erforderlich")), 409);
  assert.equal(httpStatusForError(new Error("Request zu groß")), 413);
  assert.equal(httpStatusForError(new SyntaxError("JSON kaputt")), 400);
  assert.equal(httpStatusForError(new Error("Unerwarteter interner Fehler")), 500);
});
