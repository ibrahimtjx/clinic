def test_health_reports_database_and_riyadh_time(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["timezone"] == "Asia/Riyadh"
    assert body["server_time"].endswith("+03:00")
