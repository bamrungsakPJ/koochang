# Product website screenshots — 2026-10-07

Six images in apps/admin/public/screenshots were captured from the actual mobile application source running through Expo Web at localhost:3102, in a 390×844 viewport. They are not mockups or native-device captures. Public page explicitly discloses the web rendering and synthetic data; native OS layout can vary.

Data source: disposable field_service_owner_web_test on PostgreSQL test cluster, reached through loopback SSH tunnel. scripts/owner-web-test-server.mjs recreates only its guarded test database. scripts/marketing-fixture.mjs enriches it with demonstration accounts/customer/location/equipment/jobs. No production customer records or paid providers used. Captured owner job list, owner job details, customer detail, equipment detail, technician home, technician service form. The form contains unsent synthetic text; no actual service submission or camera test is claimed.

Website has two real screen images in its hero, an interactive six-screen gallery with explanations and accessible native-dialog enlargement, owner/technician role descriptions, and an explicitly illustrated maintenance workflow. Price catalog and legal links are preserved.

Local QA start: existing API build, TEST_DATABASE_URL pointing to loopback test database, node --env-file=.env scripts/owner-web-test-server.mjs; then node --env-file=.env scripts/marketing-fixture.mjs. Expo Web EXPO_PUBLIC_API_URL=http://127.0.0.1:4101 on port 3102. Test origins only added to the QA harness.
