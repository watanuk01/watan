import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Standard ISO/IEC 18004 QR Code SVG Generator using qrcode.react.
 * Renders 100% compliant QR vectors decoded instantly by Google Lens & mobile cameras!
 */
export const QrCodeSvg = ({ value = '', size = 180, color = '#000000', bg = '#ffffff' }) => {
    const textVal = String(value || '');

    if (!textVal.trim()) {
        return <div style={{ width: size, height: size, background: bg, borderRadius: 4 }} />;
    }

    return (
        <div style={{ background: bg, padding: 6, borderRadius: 8, display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
            <QRCodeSVG
                value={textVal}
                size={size}
                bgColor={bg}
                fgColor={color}
                level="L"
                marginSize={1}
            />
        </div>
    );
};

export default QrCodeSvg;
