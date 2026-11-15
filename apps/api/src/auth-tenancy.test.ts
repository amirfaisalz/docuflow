import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { createApiApp } from "./app";

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await createApiApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  await app.close();
});

async function request(path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
}

async function register(email: string, password = "correct-horse-battery-staple") {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "DocuFlow user" }),
  });
  const body = await response.json() as { accessToken: string; user: { id: string; email: string } };
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

test("authenticated users manage organizations with role and tenant isolation", async () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = await register(`owner-${nonce}@example.test`);
  const member = await register(`member-${nonce}@example.test`);
  const outsider = await register(`outsider-${nonce}@example.test`);

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: `owner-${nonce}@example.test`, password: "correct-horse-battery-staple" }),
  });
  assert.equal(login.status, 200);
  assert.ok((await login.json() as { accessToken: string }).accessToken);

  const unauthenticated = await request("/organizations");
  assert.equal(unauthenticated.status, 401);

  const create = await request("/organizations", {
    method: "POST",
    headers: { authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ name: "Acme Docs" }),
  });
  assert.equal(create.status, 201);
  const organization = await create.json() as { id: string; name: string; slug: string; role: string };
  assert.equal(organization.name, "Acme Docs");
  assert.equal(organization.role, "OWNER");

  const list = await request("/organizations", {
    headers: { authorization: `Bearer ${owner.accessToken}` },
  });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json() as Array<{ id: string }>).map(({ id }) => id), [organization.id]);

  const addMember = await request(`/organizations/${organization.id}/members`, {
    method: "POST",
    headers: { authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ email: `member-${nonce}@example.test`, role: "MEMBER" }),
  });
  assert.equal(addMember.status, 201);
  assert.equal((await addMember.json() as { role: string }).role, "MEMBER");

  const members = await request(`/organizations/${organization.id}/members`, {
    headers: { authorization: `Bearer ${owner.accessToken}` },
  });
  assert.equal(members.status, 200);
  assert.deepEqual((await members.json() as Array<{ email: string; role: string }>).map(({ email, role }) => ({ email, role })), [
    { email: `owner-${nonce}@example.test`, role: "OWNER" },
    { email: `member-${nonce}@example.test`, role: "MEMBER" },
  ]);

  const memberRead = await request(`/organizations/${organization.id}`, {
    headers: { authorization: `Bearer ${member.accessToken}` },
  });
  assert.equal(memberRead.status, 200);

  const memberCannotManageMembers = await request(`/organizations/${organization.id}/members`, {
    method: "POST",
    headers: { authorization: `Bearer ${member.accessToken}` },
    body: JSON.stringify({ email: `outsider-${nonce}@example.test`, role: "MEMBER" }),
  });
  assert.equal(memberCannotManageMembers.status, 403);

  const outsiderCannotReadTenant = await request(`/organizations/${organization.id}`, {
    headers: { authorization: `Bearer ${outsider.accessToken}` },
  });
  assert.equal(outsiderCannotReadTenant.status, 404);

  const badLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: `owner-${nonce}@example.test`, password: "wrong-password" }),
  });
  assert.equal(badLogin.status, 401);
});
