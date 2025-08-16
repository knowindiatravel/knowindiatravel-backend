const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const app = express();
require("dotenv").config();
const path = require("path");
const bp = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");

app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: [
      "https://knowindiatravel.com",
      "https://www.knowindiatravel.com",
      "https://api.knowindiatravel.com",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

// Serve static files only if client/dist exists
const distPath = path.join(__dirname, "client", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Supabase setup
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_KEY;
const secret = process.env.VITE_SUPABASE_SECRET_KEY;

const supabase = createClient(url, key); // public
const supabase2 = createClient(url, secret); // service role

// Home route
app.get("/", (req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.json({ message: "Backend is running. No frontend build found." });
});

// ✅ Signup
app.post("/Signup", async (req, res) => {
  try {
    const { username, email, password, Pass, country, phone, image } = req.body;

    if (password !== Pass) {
      return res.json({ message: "Passwords do not match" });
    }

    // Check if email already exists in TRAVEL
    const { data: existing, error: existErr } = await supabase2
      .from("TRAVEL")
      .select("*")
      .eq("Email", email);

    if (existErr) {
      console.error("Check email error:", existErr);
      return res.json({ message: "Database error" });
    }
    if (existing && existing.length > 0) {
      return res.json({ message: "User already exists. Please Login" });
    }

    // Sign up in Supabase Auth
    const { data: authdata, error: autherror } = await supabase2.auth.signUp({
      email,
      password,
      options: { data: { phone, first_name: username, country } },
    });

    if (autherror) {
      console.error("Auth error:", autherror);
      return res.json({ message: autherror.message });
    }

    // Handle profile image upload
    let fileName = null;
    if (image) {
      try {
        const base64data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64data, "base64");
        const fileExt = image.match(/^data:image\/(\w+);base64,/)[1];
        fileName = `${Date.now()}.${fileExt}`;

        const { error: ierror } = await supabase2.storage
          .from("tourist-profile-pics")
          .upload(fileName, buffer, { contentType: `image/${fileExt}` });

        if (ierror) {
          console.error("Image upload error:", ierror);
          return res.json({ message: ierror.message });
        }
      } catch (imgErr) {
        console.error("Image processing error:", imgErr);
      }
    }

    // Insert into TRAVEL
    const { error: newerror } = await supabase2.from("TRAVEL").insert([
      {
        UserName: username,
        Email: email,
        Country: country,
        "Phone number": phone,
        path: fileName || "",
      },
    ]);

    if (newerror) {
      console.error("Insert error:", newerror);
      return res.json({ message: newerror.message });
    }

    return res.json({ message: "Signup successful. Verification email sent." });
  } catch (err) {
    console.error("Signup error:", err);
    return res.json({ message: "Internal server error" });
  }
});

// ✅ Login
app.post("/Login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const {
      data: { session, user },
      error,
    } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error("Login error:", error);
      return res.json({ message: error.message, sess: null });
    }

    if (user) {
      const { data: filePath } = await supabase
        .from("TRAVEL")
        .select("path")
        .eq("Email", email);

      if (filePath && filePath.length > 0) {
        const { data: dat } = supabase.storage
          .from("tourist-profile-pics")
          .getPublicUrl(filePath[0].path);

        return res.json({ message: dat.publicUrl, sess: session });
      }
    }

    return res.json({ message: "Login failed", sess: null });
  } catch (err) {
    console.error("Login error:", err);
    return res.json({ message: "Internal server error", sess: null });
  }
});

// ✅ Password reset
app.post("/Update", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ message: "No email provided" });

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://knowindiatravel.com/Password",
    });

    if (error) return res.json({ message: error.message });
    if (data) return res.json({ message: "Password reset link sent" });
  } catch (err) {
    console.error(err);
    return res.json({ message: "Internal server error" });
  }
});

// ✅ Admin login
app.post("/AdminLogin", async (req, res) => {
  const { admin_email, admin_password } = req.body;

  if (
    admin_email === process.env.admin_email &&
    admin_password === process.env.admin_password
  ) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: admin_email,
      password: admin_password,
    });

    if (error)
      return res.json({ message: "Wrong credentials", error: error.message });

    return res.json({ message: data.user.email, error: "" });
  }
  return res.json({});
});

// ✅ User list
app.get("/UserList", async (req, res) => {
  const { data, error } = await supabase2.auth.admin.listUsers();
  if (error) return res.json([]);
  return res.json(data.users);
});

// ✅ Traveller list
app.get("/Travellerlist", async (req, res) => {
  const { data, error } = await supabase.from("TRIP").select("*");
  if (error) return res.json([]);
  return res.json(data);
});

// ✅ Delete user
app.post("/DeleteUser", async (req, res) => {
  try {
    const { id, email } = req.body;

    const { error } = await supabase2.auth.admin.deleteUser(id);
    if (error) return res.json({ message: error.message });

    const { error: err } = await supabase
      .from("TRAVEL")
      .delete()
      .eq("Email", email);

    if (err) return res.json({ message: err.message });

    return res.json({ message: "User deleted Successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.json({ message: "Internal server error" });
  }
});

// ✅ Trip data
app.post("/Tripdata", async (req, res) => {
  try {
    const {
      id,
      name,
      email,
      phone,
      destination,
      travelDate,
      travelers,
      tripType,
      message,
    } = req.body;

    const { error: err } = await supabase.from("TRIP").insert({
      User_id: id,
      travelDate,
      name,
      email,
      phone,
      travelers,
      type: tripType,
      destination,
      message,
    });

    if (err) return res.json({ message: err.message, error: "True" });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: process.env.admin_email, pass: process.env.app_password },
    });

    await transporter.sendMail({
      from: process.env.admin_email,
      to: email,
      subject: "Booking email",
      text: "Thank you for your booking request! Our travel expert will contact you within 24 hours.",
    });

    return res.json({ message: "Check your email", error: "False" });
  } catch (error) {
    console.error("Tripdata error:", error);
    return res.json({ message: error.message, error: "True" });
  }
});

// ✅ Blogs
app.post("/Blogs", async (req, res) => {
  try {
    const { title, rating, comment, excerpt, name, email } = req.body;

    const { data, error } = await supabase
      .from("TRAVEL")
      .select("path")
      .eq("Email", email);

    if (error) return res.json({ message: error.message, url: "" });
    if (!data || data.length === 0)
      return res.json({ message: "User not found", url: "" });

    const { data: dat } = supabase.storage
      .from("tourist-profile-pics")
      .getPublicUrl(data[0].path);

    const { data: insert, error: e2 } = await supabase
      .from("Comments")
      .insert({
        Name: name,
        path: dat.publicUrl,
        title,
        ratings: rating,
        comment,
        excerpt,
      })
      .select("*");

    if (e2) return res.json({ message: e2.message, url: "" });

    return res.json({ message: insert, url: dat.publicUrl });
  } catch (err) {
    console.error("Blog error:", err);
    return res.json({ message: "Internal server error", url: "" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
