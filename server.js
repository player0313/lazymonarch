require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4242;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Razorpay backend is running",
  });
});


// ==========================================
// CREATE RAZORPAY ORDER
// ==========================================

app.post("/api/create-order", async (req, res) => {
  try {
    const {
      amount,
      currency = "INR",
      customer,
      items,
    } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        error: "Invalid amount",
      });
    }

    if (!customer || !customer.name || !customer.phone) {
      return res.status(400).json({
        error: "Customer details are required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Order items are required",
      });
    }

    // Amount received from frontend is in rupees.
    // Razorpay requires paise.
    const amountInPaise = Math.round(Number(amount) * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email || "",
      },
    });

    res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error("Create order error:", error);

    res.status(500).json({
      error: "Unable to create Razorpay order",
    });
  }
});


// ==========================================
// VERIFY RAZORPAY PAYMENT
// ==========================================

app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        verified: false,
        error: "Missing payment verification details",
      });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest("hex");

    const isValid = crypto.timingSafeEqual(
      Buffer.from(generatedSignature),
      Buffer.from(razorpay_signature)
    );

    if (!isValid) {
      return res.status(400).json({
        verified: false,
        error: "Invalid payment signature",
      });
    }

    res.json({
      verified: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });

  } catch (error) {
    console.error("Payment verification error:", error);

    res.status(500).json({
      verified: false,
      error: "Payment verification failed",
    });
  }
});


// ==========================================
// CANCEL / REFUND PAID ORDER
// ==========================================

app.post("/api/refund-payment", async (req, res) => {
  try {
    const {
      paymentId,
      amount,
      reason,
    } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: "Payment ID is required",
      });
    }

    const refundOptions = {};

    // If amount is supplied, refund that amount.
    // Razorpay expects paise.
    if (amount && Number(amount) > 0) {
      refundOptions.amount = Math.round(
        Number(amount) * 100
      );
    }

    if (reason) {
      refundOptions.notes = {
        reason: String(reason),
      };
    }

    const refund = await razorpay.payments.refund(
      paymentId,
      refundOptions
    );

    res.json({
      success: true,
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
    });

  } catch (error) {
    console.error("Refund error:", error);

    res.status(500).json({
      success: false,
      error:
        error?.error?.description ||
        error?.message ||
        "Refund failed",
    });
  }
});


// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${PORT}`
  );
});

