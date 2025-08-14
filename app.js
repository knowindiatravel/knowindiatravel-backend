const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const app = express();
require("dotenv").config();
const path = require("path");
const bp = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

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
app.use(express.static(path.join(__dirname, "client", "dist")));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_KEY;
const secret = process.env.VITE_SUPABASE_SECRET_KEY;

// connection with DataBase
const supabase = createClient(url, key);
const supabase2 = createClient(url, secret);

// Home-route
app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

// Signup-route
app.post("/Signup", async (req, res) => {
  const { username, email: useremail, password: userpassword, Pass: userpass, country: usercountry, phone: userphone, image } = req.body;

  const base64data = image.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64data, "base64");
  const fileExt = image.match(/^data:image\/(\w+);base64,/)[1];
  const fileName = `${Date.now()}.${fileExt}`;

  if (userpassword !== userpass) {
    return res.json({ message: "password do not match" });
  }

  const { data, error } = await supabase
    .from("TRAVEL")
    .select("*")
    .eq("UserName", username);

  if (data && Object.keys(data).length > 0) {
    return res.json({ message: "UserName is already taken." });
  }

  const { data: authdata, error: autherror } = await supabase.auth.signUp({
    email: useremail,
    password: userpassword,
    options: {
      data: {
        phone: userphone,
        first_name: username,
        country: usercountry,
      },
    },
  });

  if (autherror) {
    console.log("Error during authentication!  ->  ", autherror);
    return res.send({ message: autherror.message });
  }

  const { data: dat, error: err } = await supabase
    .from("TRAVEL")
    .select("*")
    .eq("Email", useremail);

  if (Object.keys(dat).length > 0) {
    return res.send({ message: "User already Exist.Please Login" });
  } else if (err) {
    console.log(err);
    return res.send({ message: err.message });
  }

  const { data: idata, error: ierror } = await supabase.storage
    .from("tourist-profile-pics")
    .upload(fileName, buffer, {
      contentType: `image/${fileExt}`,
    });

  if (ierror) return res.send({ message: ierror.message });

  const { error: newerror } = await supabase
    .from("TRAVEL")
    .insert([
      {
        UserName: username,
        Email: useremail,
        Country: usercountry,
        "Phone number": userphone,
        path: fileName,
      },
    ])
    .select();

  if (newerror) {
    console.log("Error during insertion!  ->  ", newerror);
    return res.send({ message: newerror.message });
  }
  return res.send({ message: "Email sent" });
});

// Login-route
app.post("/Login", async (req, res) => {
  const { email, password: pass } = req.body;

  const {
    data: { session, user },
    error,
  } = await supabase.auth.signInWithPassword({
    email: email,
    password: pass,
  });

  if (error) {
    console.log(error);
    return res.send({ message: error.message, sess: null });
  }

  if (user) {
    const { data: filePath, error: e } = await supabase
      .from("TRAVEL")
      .select("path")
      .eq("Email", email);

    if (e) return res.send({ message: e.message, sess: null });

    const { data: dat } = supabase.storage
      .from("tourist-profile-pics")
      .getPublicUrl(filePath[0].path);

    return res.send({ message: dat.publicUrl, sess: session });
  }

  return res.send({ message: "Login failed", sess: null });
});

// Email confirmation Route
app.post("/Update", async (req, res) => {
  const { email: user_email } = req.body;

  if (!user_email) return res.send({ message: "No email provided" });

  const { data, error } = await supabase.auth.resetPasswordForEmail(user_email, {
    redirectTo: "https://knowindiatravel.com/Password",
  });

  if (error) return res.send({ message: error.message });
  return res.send({ message: "Password reset link sent" });
});

// Admin Login-route
app.post("/AdminLogin", async (req, res) => {
  const { admin_email, admin_password } = req.body;

  if (admin_email == process.env.admin_email && admin_password == process.env.admin_password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: admin_email,
      password: admin_password,
    });

    if (error) return res.send({ message: "Wrong credentials", error: error.message });
    return res.send({ message: data.user.email, error: "" });
  }
  return res.send({});
});

// List User Route
app.get("/UserList", async (req, res) => {
  const { data: { users }, error } = await supabase2.auth.admin.listUsers();
  if (error) return res.json([]);
  return res.json(users);
});

// Traveller list
app.get("/Travellerlist", async (req, res) => {
  const { data, error } = await supabase.from("TRIP").select("*");
  if (error) return res.json([]);
  return res.json(data);
});

// Delete User Route
app.post("/DeleteUser", async (req, res) => {
  const { id, email } = req.body;

  const { error } = await supabase2.auth.admin.deleteUser(id);
  if (error) return res.send({ message: error.message });

  const { error: err } = await supabase.from("TRAVEL").delete().eq("Email", email).select();
  if (err) return res.send({ message: err.message });

  return res.send({ message: "User deleted Successfully" });
});

// Trip Data Route
app.post("/Tripdata", async (req, res) => {
  const { id, name, email, phone, destination, travelDate, travelers, tripType, message } = req.body;

  const { data, error: err } = await supabase.from("TRIP").insert({
    User_id: id,
    travelDate,
    name,
    email,
    phone,
    travelers,
    type: tripType,
    destination,
    message,
  }).select();

  if (!data) return res.send({ message: err.message, error: "True" });

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.admin_email, pass: process.env.app_password },
  });

  try {
    await transporter.sendMail({
      from: process.env.admin_email,
      to: email,
      subject: "Booking email",
      text: "Thank you for your booking request! Our travel expert will contact you within 24 hours.",
    });
    return res.send({ message: "Check ur email", error: "False" });
  } catch (error) {
    return res.send({ message: error.message, error: "True" });
  }
});

// Blogs route
app.post("/Blogs", async (req, res) => {
  const { title, rating, comment, excerpt, name, email } = req.body;

  const { data, error } = await supabase.from("TRAVEL").select("path").eq("Email", email);
  if (error) return res.send({ message: error.message, url: "" });

  const { data: dat } = supabase.storage.from("tourist-profile-pics").getPublicUrl(data[0].path);

  const { data: insert, error: e } = await supabase.from("Comments").insert({
    Name: name,
    path: dat.publicUrl,
    title,
    ratings: rating,
    comment,
    excerpt,
  }).select("*");

  if (insert) return res.send({ message: insert, url: dat.publicUrl });
  if (e) return res.send({ message: e.message, url: "" });
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
