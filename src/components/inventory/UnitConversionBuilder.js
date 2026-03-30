import React, { useState, useEffect, useRef } from 'react';
import { BASE_UNITS, CONTAINER_UNITS, UNITS, isBaseUnit, getUnitLabel } from '../../services/inventoryService';
import { MdArrowForward, MdCheckCircle, MdDelete, MdAdd } from 'react-icons/md';

/**
 * UnitConversionBuilder
 *
 * A step-by-step builder that appears when a container unit (box, pack, bag, etc.)
 * is selected. It walks the user through defining what each container holds,
 * drilling down until a base measurable unit (kg, g, l, ml, pcs, portions) is reached.
 *
 * Props:
 *   stockingUnit  — current item unit from parent form (e.g. 'box')
 *   value         — { has_conversion, levels: [{from, to, factor}], base_factor }
 *   baseUnit      — the resolved base unit string
 *   onChange      — fn({ unit_conversion, base_unit })
 */

// Units that can be targets at intermediate levels (containers + base)
const allTargetUnits = [...CONTAINER_UNITS, ...BASE_UNITS];

const UnitConversionBuilder = ({ stockingUnit, value, baseUnit, onChange }) => {
    const [levels, setLevels] = useState([]);
    const needsConversion = !isBaseUnit(stockingUnit);
    const loadedSavedRef = useRef(false);
    const prevStockingUnit = useRef(stockingUnit);
    const userInteracted = useRef(false);

    // 1. Load saved conversion data whenever value prop updates (edit mode)
    useEffect(() => {
        if (loadedSavedRef.current) return;
        if (value?.has_conversion && value.levels?.length > 0) {
            setLevels(value.levels.map(lv => ({
                from: lv.from,
                to: lv.to,
                factor: lv.factor,
            })));
            loadedSavedRef.current = true;
            userInteracted.current = true; // treat loaded data as "interacted"
        }
    }, [value]);

    // 2. Handle stocking unit: init empty level or reset on unit change
    useEffect(() => {
        if (isBaseUnit(stockingUnit)) {
            onChange({
                unit_conversion: { has_conversion: false, levels: [], base_factor: 1 },
                base_unit: stockingUnit,
            });
            setLevels([]);
            loadedSavedRef.current = false;
            prevStockingUnit.current = stockingUnit;
            return;
        }

        // If stocking unit actually changed (user switched dropdown), reset
        if (prevStockingUnit.current !== stockingUnit && levels.length > 0) {
            setLevels([{ from: stockingUnit, to: '', factor: '' }]);
            loadedSavedRef.current = false;
            userInteracted.current = true;
            prevStockingUnit.current = stockingUnit;
            return;
        }

        prevStockingUnit.current = stockingUnit;

        // Only create empty first level if no saved data will arrive
        // (i.e. value is confirmed to have no conversion AND we haven't loaded saved data)
        if (levels.length === 0 && !loadedSavedRef.current && value && !value.has_conversion) {
            setLevels([{ from: stockingUnit, to: '', factor: '' }]);
        }
    }, [stockingUnit, value]); // eslint-disable-line react-hooks/exhaustive-deps

    // 3. Whenever levels change, recalculate and notify parent
    useEffect(() => {
        if (!needsConversion || levels.length === 0) return;

        // Check if chain is complete (last level targets a base unit)
        const lastLevel = levels[levels.length - 1];
        const isComplete = lastLevel && isBaseUnit(lastLevel.to) && Number(lastLevel.factor) > 0;

        if (isComplete) {
            // Calculate base factor (product of all level factors)
            const baseFactor = levels.reduce((product, lv) => product * (Number(lv.factor) || 1), 1);
            const resolvedBase = lastLevel.to;

            onChange({
                unit_conversion: {
                    has_conversion: true,
                    levels: levels.map(lv => ({
                        from: lv.from,
                        to: lv.to,
                        factor: Number(lv.factor),
                    })),
                    base_factor: Math.round(baseFactor * 10000) / 10000,
                },
                base_unit: resolvedBase,
            });
        } else if (userInteracted.current) {
            // Only report incomplete chain if user has actually interacted
            // (prevents wiping saved parent data during initialization)
            onChange({
                unit_conversion: {
                    has_conversion: false,
                    levels: levels.filter(lv => lv.to && lv.factor),
                    base_factor: 1,
                },
                base_unit: stockingUnit,
            });
        }
    }, [levels]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!needsConversion) return null;

    const updateLevel = (index, field, val) => {
        userInteracted.current = true;
        setLevels(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: val };

            // If user selected a 'to' unit:
            if (field === 'to') {
                // Remove any levels after this one
                const trimmed = updated.slice(0, index + 1);

                // If the target is still a container, add next level
                if (!isBaseUnit(val) && val !== '') {
                    trimmed.push({ from: val, to: '', factor: '' });
                }
                return trimmed;
            }
            return updated;
        });
    };

    const removeLevel = (index) => {
        if (index === 0) return; // Can't remove first level
        userInteracted.current = true;
        setLevels(prev => prev.slice(0, index));
    };

    // Calculate running total factor
    const getRunningFactor = (upToIndex) => {
        let f = 1;
        for (let i = 0; i <= upToIndex; i++) {
            f *= Number(levels[i]?.factor) || 0;
        }
        return Math.round(f * 10000) / 10000;
    };

    const lastLevel = levels[levels.length - 1];
    const isComplete = lastLevel && isBaseUnit(lastLevel.to) && Number(lastLevel.factor) > 0;
    const allValid = levels.every(lv => lv.to && Number(lv.factor) > 0);

    // Determine which target units to exclude (already used as 'from')
    const usedUnits = levels.map(lv => lv.from);

    return (
        <div className="ucb-container">
            <div className="ucb-header">
                <span className="ucb-header-icon">📦</span>
                <div>
                    <strong>Unit Breakdown</strong>
                    <span className="ucb-header-sub">Define what each {getUnitLabel(stockingUnit).toLowerCase()} contains</span>
                </div>
            </div>

            <div className="ucb-levels">
                {levels.map((level, i) => {
                    // Available target units: exclude upstream 'from' units, but always
                    // keep the currently-selected 'to' value so it stays visible in dropdown
                    const excludeSet = new Set(usedUnits);
                    // Keep this level's own selected value visible
                    if (level.to) excludeSet.delete(level.to);
                    const availableTargets = allTargetUnits.filter(u => !excludeSet.has(u));

                    return (
                        <div key={i} className="ucb-level">
                            <div className="ucb-level-row">
                                <span className="ucb-level-num">{i + 1}</span>
                                <span className="ucb-level-from">1 {getUnitLabel(level.from)}</span>
                                <MdArrowForward className="ucb-arrow" />
                                <input
                                    type="number"
                                    className="ucb-factor-input"
                                    placeholder="Qty"
                                    min="0.01"
                                    step="any"
                                    value={level.factor}
                                    onChange={(e) => updateLevel(i, 'factor', e.target.value)}
                                />
                                <select
                                    className="ucb-unit-select"
                                    value={level.to}
                                    onChange={(e) => updateLevel(i, 'to', e.target.value)}
                                >
                                    <option value="">Select unit…</option>
                                    <optgroup label="Base Measurable Units">
                                        {BASE_UNITS
                                            .filter(u => !excludeSet.has(u))
                                            .map(u => (
                                                <option key={u} value={u}>{getUnitLabel(u)}</option>
                                            ))}
                                    </optgroup>
                                    <optgroup label="Container Units">
                                        {CONTAINER_UNITS
                                            .filter(u => !excludeSet.has(u))
                                            .map(u => (
                                                <option key={u} value={u}>{getUnitLabel(u)}</option>
                                            ))}
                                    </optgroup>
                                </select>
                                {i > 0 && (
                                    <button
                                        type="button"
                                        className="ucb-remove-btn"
                                        onClick={() => removeLevel(i)}
                                        title="Remove this level"
                                    >
                                        <MdDelete />
                                    </button>
                                )}
                            </div>

                            {/* Show running total */}
                            {Number(level.factor) > 0 && level.to && (
                                <div className="ucb-level-summary">
                                    1 {getUnitLabel(stockingUnit)} = {getRunningFactor(i)} {getUnitLabel(level.to)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Completion status */}
            <div className={`ucb-status ${isComplete ? 'complete' : 'incomplete'}`}>
                {isComplete ? (
                    <>
                        <MdCheckCircle />
                        <span>
                            <strong>1 {getUnitLabel(stockingUnit)}</strong> = <strong>{getRunningFactor(levels.length - 1)} {getUnitLabel(lastLevel.to)}</strong>
                        </span>
                    </>
                ) : (
                    <>
                        <span className="ucb-status-dot" />
                        <span>
                            {levels.length === 0
                                ? `Define what each ${getUnitLabel(stockingUnit).toLowerCase()} contains`
                                : !allValid
                                    ? 'Fill in quantity and target unit for each level'
                                    : `${getUnitLabel(lastLevel?.to || '')} is not a base unit — add another level`
                            }
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};

export default UnitConversionBuilder;
