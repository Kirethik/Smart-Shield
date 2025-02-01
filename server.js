const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { createConnection } = require("./sqlconnect"); 
require("dotenv").config();

const app = express();
const PORT = 3000; // Use the same port for consistency

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("front_end"));
app.use(cors());
app.use(bodyParser.json());

const con = createConnection();

// ✅ Nodemailer Setup
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ✅ Fetch Emails for a Given Vehicle Number
async function getEmails(vehicleNumber) {
  return new Promise((resolve, reject) => {
    con.query(
      "SELECT owner_mail_id, emergency_email1, emergency_email2 FROM RC WHERE Vehicle_NO = ?",
      [vehicleNumber],
      (error, results) => {
        if (error) {
          reject(error);
        } else if (results.length > 0) {
          resolve([
            results[0].owner_mail_id,
            results[0].emergency_email1,
            results[0].emergency_email2,
          ].filter(email => email)); // Remove empty/null emails
        } else {
          resolve([]);
        }
      }
    );
  });
}

// ✅ **API to Fetch Accident Data**
app.get("/api/accidents", (req, res) => {
  const { status } = req.query;

  let query = `
    SELECT 
      accident.accident_id AS id, 
      accident.acc_vehicle_num AS vehicleReg, 
      RC.emergency_email1 AS emergencyContact, 
      accident.amb_vehicle_num AS ambulance, 
      accident.status AS status, 
      CONCAT('https://maps.google.com/?q=', accident.acc_loc) AS trackingLink
    FROM accident
    LEFT JOIN RC ON accident.acc_vehicle_num = RC.Vehicle_NO
  `;

  if (status && status !== "all") {
    query += ` WHERE accident.status = ?`;
  }

  con.query(query, status && status !== "all" ? [status] : [], (error, results) => {
    if (error) {
      console.error("Error fetching accident data:", error);
      return res.status(500).json({ message: "Error retrieving accident data" });
    }
    res.json(results);
  });
});

// ✅ **API to Submit Accident Data**
app.post("/submit-accident", async (req, res) => {
  const { acc_vehicle_num, amb_vehicle_num, acc_lat, acc_lng, hospital } = req.body;

  if (!acc_vehicle_num || !amb_vehicle_num || !acc_lat || !acc_lng || !hospital) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  try {
    const acc_loc = `${acc_lat},${acc_lng}`;
    const status = "pending";

    // ✅ Insert accident record into the database
    const query = `
      INSERT INTO accident (acc_vehicle_num, amb_vehicle_num, acc_loc, hospital, status)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const [results] = await con.promise().execute(query, [
      acc_vehicle_num,
      amb_vehicle_num,
      acc_loc,
      hospital,
      status,
    ]);

    // ✅ Fetch email contacts
    const emailRecipients = await getEmails(acc_vehicle_num);
    if (emailRecipients.length === 0) {
      return res.status(404).json({ message: "No email contacts found for this vehicle." });
    }

    // ✅ Email Content
    const googleMapsLink = `https://www.google.com/maps?q=${acc_lat},${acc_lng}`;
    const hospitalLink = `https://www.google.com/maps/search/${hospital}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: emailRecipients.join(","),
      subject: "🚨 Urgent: Accident Report",
      html: `
        <h2>🚑 Accident Alert!</h2>
        <p><strong>Vehicle Involved:</strong> ${acc_vehicle_num}</p>
        <p><strong>Ambulance Assigned:</strong> ${amb_vehicle_num}</p>
        <p><strong>Accident Location:</strong> <a href="${googleMapsLink}">View on Map</a></p>
        <p><strong>Hospital Assigned:</strong> <a href="${hospitalLink}">${hospital}</a></p>
        <p style="color: red;"><strong>Immediate action required!</strong></p>
      `,
    };

    // ✅ Send Email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Email Error:", error);
        return res.status(500).json({
          message: "Accident reported, but email not sent!",
          emailSent: false,
          error: error.message,
        });
      }
      res.status(200).json({
        message: "Accident reported successfully, and email sent!",
        emailSent: true,
      });
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      message: "Server error. Please try again.",
      error: error.message,
    });
  }
});

// ✅ Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
