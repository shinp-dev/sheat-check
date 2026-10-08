-- A student session owns at most one seat per room; a seat has at most one owner.
-- The random claim token is required for subsequent actions, not the publicly enterable student ID.
CREATE TABLE IF NOT EXISTS seat_claims (
  room_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, seat_id),
  UNIQUE (room_id, student_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
