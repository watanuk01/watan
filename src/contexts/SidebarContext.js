import React, { createContext, useContext, useState, useEffect } from 'react';

const SidebarContext = createContext(null);

export const useSidebar = () => {
    const context = useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within a SidebarProvider');
    }
    return context;
};

export const SidebarProvider = ({ children }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [activeSubmenu, setActiveSubmenu] = useState(null);

    // Close mobile sidebar on resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 1024) {
                setIsMobileOpen(false);
            }
        };

        // Initial check
        handleResize();

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const toggleCollapse = () => {
        setIsCollapsed(prev => !prev);
    };

    const toggleMobile = () => {
        setIsMobileOpen(prev => !prev);
    };

    const closeMobile = () => {
        setIsMobileOpen(false);
    };

    const toggleSubmenu = (key) => {
        setActiveSubmenu(prev => prev === key ? null : key);
    };

    return (
        <SidebarContext.Provider value={{
            isCollapsed,
            isMobileOpen,
            activeSubmenu,
            toggleCollapse,
            toggleMobile,
            closeMobile,
            toggleSubmenu,
        }}>
            {children}
        </SidebarContext.Provider>
    );
};

export default SidebarContext;
