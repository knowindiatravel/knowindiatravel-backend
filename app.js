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
      "https://knowindiatravel.com", // Production frontend
      "https://www.knowindiatravel.com",
      "https://api.knowindiatravel.com", // Your backend API
      "http://localhost:5173", // Keep for development
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

const supabase = createClient(url, key);
const supabase2 = createClient(url, secret);

// Home route
app.get("/", (req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.send("Backend is running. No frontend build found.");
});

// Signup
app.post("/Signup", async (req, res) => {
  try {
    const { username, email, password, Pass, country, phone, image } = req.body;

    if (password !== Pass) {
      return res.json({ message: "password do not match" });
    }

    // Check if username exists
    const { data: existingUser } = await supabase2
      .from("TRAVEL")
      .select("*")
      .eq("UserName", username);

    if (existingUser && existingUser.length > 0) {
      return res.json({ message: "UserName is already taken." });
    }

    // Sign up in Supabase Auth
    const { data: authdata, error: autherror } = await supabase2.auth.signUp({
      email,
      password,
      options: { data: { phone, first_name: username, country } },
    });

    if (autherror) {
      console.log("Auth error:", autherror);
      return res.send({ message: autherror.message });
    }

    // Check if email already exists
    const { data: dat, error: err } = await supabase2
      .from("TRAVEL")
      .select("*")
      .eq("Email", email);

    if (dat && dat.length > 0) {
      return res.send({ message: "User already Exist. Please Login" });
    }

    // Handle profile image upload only if image exists
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

        if (ierror) return res.send({ message: ierror.message });
      } catch (imgErr) {
        console.error("Image upload error:", imgErr);
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
      console.log("Insert error:", newerror);
      return res.send({ message: newerror.message });
    }

    return res.send({ message: "Email sent" });
  } catch (err) {
    console.error("Signup error:", err);
    return res.send({ message: "Internal server error" });
  }
});

// Login
app.post("/Login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const {
      data: { session, user },
      error,
    } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.log(error);
      return res.send({ message: error.message, sess: null });
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

        return res.send({ message: dat.publicUrl, sess: session });
      }
    }

    return res.send({ message: "Login failed", sess: null });
  } catch (err) {
    console.error("Login error:", err);
    return res.send({ message: "Internal server error", sess: null });
  }
});

// Update (password reset)
app.post("/Update", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.send({ message: "No email provided" });

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://knowindiatravel.com/Password",
    });

    if (error) return res.send({ message: error.message });
    if (data) return res.send({ message: "Password reset link sent" });
  } catch (err) {
    console.error(err);
    return res.send({ message: "Internal server error" });
  }
});

// Admin login
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
      return res.send({ message: "Wrong credentials", error: error.message });

    return res.send({ message: data.user.email, error: "" });
  }
  return res.send({});
});

// User list
app.get("/UserList", async (req, res) => {
  const { data, error } = await supabase2.auth.admin.listUsers();
  if (error) return res.json([]);
  return res.json(data.users);
});

// Traveller list
app.get("/Travellerlist", async (req, res) => {
  const { data, error } = await supabase.from("TRIP").select("*");
  if (error) return res.json([]);
  return res.json(data);
});

// Delete user
app.post("/DeleteUser", async (req, res) => {
  try {
    const { id, email } = req.body;

    const { error } = await supabase2.auth.admin.deleteUser(id);
    if (error) return res.send({ message: error.message });

    const { error: err } = await supabase
      .from("TRAVEL")
      .delete()
      .eq("Email", email);

    if (err) return res.send({ message: err.message });

    return res.send({ message: "User deleted Successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.send({ message: "Internal server error" });
  }
});

// Trip data
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

    if (err) return res.send({ message: err.message, error: "True" });

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

    return res.send({ message: "Check your email", error: "False" });
  } catch (error) {
    return res.send({ message: error.message, error: "True" });
  }
});

// Blogs
app.post("/Blogs", async (req, res) => {
  try {
    const { title, rating, comment, excerpt, name, email } = req.body;

    const { data, error } = await supabase
      .from("TRAVEL")
      .select("path")
      .eq("Email", email);

    if (error) return res.send({ message: error.message, url: "" });
    if (!data || data.length === 0)
      return res.send({ message: "User not found", url: "" });

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

    if (e2) return res.send({ message: e2.message, url: "" });

    return res.send({ message: insert, url: dat.publicUrl });
  } catch (err) {
    console.error("Blog error:", err);
    return res.send({ message: "Internal server error", url: "" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
