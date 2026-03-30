const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

const pagesDir = path.join(__dirname, '../src/pages');

walkDir(pagesDir, (filePath) => {
    if (!filePath.endsWith('.js')) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // We want to replace `<button className="..." ...><MdRefresh ... /> [Refresh]?</button>` 
    // with `<button className="btn-refresh" ...><MdRefresh ... /></button>`
    // Because the button structure varies, let's use a regex that matches the whole button.
    
    // Regex explanation:
    // <button ([^>]*)>            - matches opening button tag and captures attributes
    // \s*<MdRefresh\s*([^>]*)\/>  - matches MdRefresh, capturing its attributes if any (like spin)
    // (\s*Refresh\s*)?            - optionally matches the word "Refresh" with whitespace
    // <\/button>                  - matches closing tag
    
    const buttonRegex = /<button\s+([^>]*)>\s*<MdRefresh\s*([^>]*)\/>(?:(?:\s*Refresh\s*)?|\s*)<\/button>/g;
    
    content = content.replace(buttonRegex, (match, attrs, mdRefreshAttrs) => {
        // Strip out the old className
        let newAttrs = attrs.replace(/className=(["'])[^"']*\1/, 'className="btn-refresh"');
        
        // If there was no className for some reason, add it
        if (!newAttrs.includes('className=')) {
            newAttrs = `className="btn-refresh" ${newAttrs}`;
        }
        
        return `<button ${newAttrs}><MdRefresh ${mdRefreshAttrs}/></button>`;
    });

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
});
