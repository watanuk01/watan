/**
 * Watan Central Kitchen — Cloud Functions
 * 
 * sendInvoiceEmail: Generates a PDF from invoice HTML and emails it to the restaurant.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// ─── GMAIL SMTP CONFIG ───
const GMAIL_USER = 'watanuk01@gmail.com';
const GMAIL_APP_PASSWORD = 'rkzs qgyc jdsi wjmh';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
    },
});

/**
 * sendInvoiceEmail — Callable Cloud Function
 * 
 * Accepts: { invoiceId, recipientEmail, invoiceHtml }
 * Sends the invoice as an email with an HTML body (and inline PDF if puppeteer available).
 */
exports.sendInvoiceEmail = onCall({ maxInstances: 10 }, async (request) => {
    const { invoiceId, recipientEmail, invoiceHtml } = request.data;

    if (!recipientEmail || !invoiceHtml) {
        throw new HttpsError('invalid-argument', 'recipientEmail and invoiceHtml are required');
    }

    // Fetch invoice data from Firestore for subject line
    let invoiceNumber = 'Invoice';
    let restaurantName = '';
    if (invoiceId) {
        try {
            const invoiceDoc = await admin.firestore().collection('invoices').doc(invoiceId).get();
            if (invoiceDoc.exists) {
                const data = invoiceDoc.data();
                invoiceNumber = data.invoice_number || invoiceNumber;
                restaurantName = data.customer?.restaurant_name || data.customer?.name || '';
            }
        } catch (err) {
            console.warn('Could not fetch invoice data:', err.message);
        }
    }

    // Wrap the invoice HTML in a complete email template
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
                .email-wrapper { max-width: 900px; margin: 0 auto; background: #ffffff; }
                .email-header { background: #1a1a2e; color: #d4af37; padding: 24px 40px; }
                .email-header h1 { margin: 0; font-size: 22px; font-weight: 800; }
                .email-header p { margin: 4px 0 0; color: #ccc; font-size: 14px; }
                .email-body { padding: 0; }
                .email-footer { background: #f9fafb; padding: 20px 40px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 10px 12px; text-align: left; }
                th { background: #f9fafb; color: #374151; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
                td { border-bottom: 1px solid #f3f4f6; color: #111; }
                .text-right { text-align: right; }
            </style>
        </head>
        <body>
            <div class="email-wrapper">
                <div class="email-header">
                    <h1>📄 ${invoiceNumber}</h1>
                    <p>VAT Invoice from Watan Central Kitchen</p>
                </div>
                <div class="email-body">
                    ${invoiceHtml}
                </div>
                <div class="email-footer">
                    <p>This is a VAT invoice issued under UK regulations.</p>
                    <p>If you have any questions, please reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    try {
        await transporter.sendMail({
            from: `"Watan Central Kitchen" <${GMAIL_USER}>`,
            to: recipientEmail,
            subject: `Invoice ${invoiceNumber}${restaurantName ? ` — ${restaurantName}` : ''}`,
            html: emailHtml,
        });

        console.log(`Invoice email sent to ${recipientEmail} for ${invoiceNumber}`);

        // Update invoice to track email sent
        if (invoiceId) {
            try {
                await admin.firestore().collection('invoices').doc(invoiceId).update({
                    email_sent_to: recipientEmail,
                    email_sent_at: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (updateErr) {
                console.warn('Could not update invoice email tracking:', updateErr.message);
            }
        }

        return { success: true, message: `Invoice emailed to ${recipientEmail}` };
    } catch (err) {
        console.error('Email send failed:', err);
        throw new HttpsError('internal', `Failed to send email: ${err.message}`);
    }
});
