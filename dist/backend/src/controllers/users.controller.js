"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = listUsers;
exports.createUser = createUser;
exports.updateUserRole = updateUserRole;
exports.deleteUser = deleteUser;
exports.getMe = getMe;
const auth_1 = require("firebase-admin/auth");
const User_1 = require("../models/User");
async function listUsers(req, res) {
    try {
        const users = await User_1.User.find({}).sort({ createdAt: -1 }).lean();
        res.json({ ok: true, data: users });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function createUser(req, res) {
    try {
        const { email, password, name, role } = req.body;
        if (!email || typeof email !== "string") {
            res.status(400).json({ ok: false, error: "email is required" });
            return;
        }
        if (!password || typeof password !== "string" || password.length < 6) {
            res.status(400).json({ ok: false, error: "password is required and must be at least 6 characters" });
            return;
        }
        const assignedRole = role === "admin" ? "admin" : "user";
        // Create user in Firebase Auth
        const firebaseUser = await (0, auth_1.getAuth)().createUser({
            email,
            password,
            displayName: name ?? email,
        });
        // Persist in MongoDB
        const user = await User_1.User.findOneAndUpdate({ uid: firebaseUser.uid }, {
            $set: {
                email,
                name: name ?? email,
                role: assignedRole,
                lastLoginAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
        }, { upsert: true, new: true });
        res.status(201).json({ ok: true, data: user });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Firebase already-exists error
        if (msg.includes("email-already-exists")) {
            res.status(409).json({ ok: false, error: "A user with that email already exists" });
            return;
        }
        res.status(500).json({ ok: false, error: msg });
    }
}
async function updateUserRole(req, res) {
    try {
        const { uid } = req.params;
        const { role } = req.body;
        if (role !== "admin" && role !== "user") {
            res.status(400).json({ ok: false, error: "role must be 'admin' or 'user'" });
            return;
        }
        const user = await User_1.User.findOneAndUpdate({ uid }, { $set: { role } }, { new: true });
        if (!user) {
            res.status(404).json({ ok: false, error: "User not found" });
            return;
        }
        res.json({ ok: true, data: user });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function deleteUser(req, res) {
    try {
        const { uid } = req.params;
        const me = req.adminUser;
        if (me?.uid === uid) {
            res.status(400).json({ ok: false, error: "Cannot delete your own account" });
            return;
        }
        // Remove from Firebase Auth
        await (0, auth_1.getAuth)().deleteUser(uid).catch(() => undefined);
        await User_1.User.deleteOne({ uid });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function getMe(req, res) {
    const me = req.adminUser;
    res.json({ ok: true, data: me });
}
