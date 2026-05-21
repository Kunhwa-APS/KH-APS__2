const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
    const htmlPath = path.join(__dirname, 'debug_output.html');
    if (!fs.existsSync(htmlPath)) {
        console.log("No debug_output.html found.");
        process.exit(1);
    }
    
    const html = fs.readFileSync(htmlPath, 'utf8');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        timeout: 90000
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);
    
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
    
    const pdfBuffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    
    await browser.close();
    
    fs.writeFileSync(path.join(__dirname, 'debug_pdf.pdf'), pdfBuffer);
    console.log("PDF generated successfully and saved to debug_pdf.pdf");
}

main().catch(err => {
    console.error("Error rendering PDF:", err);
});
