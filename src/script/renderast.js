/* jshint undef:true */
/* jshint unused:strict */
/* jshint browser:true */
/* jshint node:true */
/* jshint trailing:true */

if ( typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define(["./renderutensils", "./renderskeleton", "./node/textutensils", "./node/flatten", "./node/dotmap"], function(utl, skel, txt, flatten, map) {
    /**
     *
     * renders an abstract syntax tree of a sequence chart
     *
     * knows of:
     *  - the syntax tree
     *  - the target canvasf
     *
     * Defines default sizes and distances for all objects.

     issue #13
     To get markers to work in canvg and to color them the same color as
     the associate line, we'll need to do something like this:

     <svg xmlns="http://www.w3.org/2000/svg" version="1.1">
     <g transform="translate(10,20)">
     <defs>
     <marker viewBox="0 0 10 10" id="end" refX="9" refY="3" markerUnits="strokeWidth" markerWidth="10" markerHeight="10" orient="auto">
     <path d="M 1 1 l 8 2 l -8 2 " fill="none" stroke="#ABCDEF" stroke-width="1"/>
     </marker>
     </defs>
     <line x1="50" y1="20" x2="210" y2="20" stroke-width="2" stroke="#ABCDEF" marker-end="url(#end)"/>
     </g>
     </svg>
     * @exports renderast
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */

    var PAD_VERTICAL = 3;
    var DEFAULT_INTER_ENTITY_SPACING = 160;
    var gInterEntitySpacing = DEFAULT_INTER_ENTITY_SPACING;
    var DEFAULT_ENTITY_WIDTH = 100;
    var gEntityWidth = DEFAULT_ENTITY_WIDTH;
    var DEFAULT_ENTITY_HEIGHT = 34;
    var gEntityHeight = DEFAULT_ENTITY_HEIGHT;
    var DEFAULT_ARCROW_HEIGHT = 38;
    var LINE_WIDTH = 2;
    var INNERELEMENTPREFIX = "mscgen_js$svg$";
    
    // TODO: === to use in the css
    var gArcRowHeight = DEFAULT_ARCROW_HEIGHT;
    var DEFAULT_ARC_GRADIENT = 0;
    var gArcGradient = DEFAULT_ARC_GRADIENT;
    var gWordWrapArcs = false;
    var gMaxDepth = 0;

    var gEntityXHWM = 0;
    var gEntity2X = {};
    var gEntity2ArcColor = {};
    var gTextHeight = 12;
    var gInnerElementId = INNERELEMENTPREFIX;
    /* sensible default - gets overwritten in bootstrap */

    var gDocument;
    var defs;
    var lifelinelayer;
    var sequence;
    var notelayer;
    var arcspanlayer;


    /* ------------------ row memory ---------------------- */

    /**
     * Functions to help determine the correct height and
     * y position of rows befor rendering them.
     */
    var gRowInfo = [];

    /**
     * clearRowInfo() - resets the helper array to an empty one
     */
    function clearRowInfo() {
        gRowInfo = [];
    }

    /**
     * getRowInfo() - returns the row info for a given pRowNumber.
     * If the row info was not set earlier with a setRowinfo call
     * the function returns a best guess, based on defaults
     *
     * @param <int> pRowNumber
     */
    function getRowInfo(pRowNumber) {
        if (gRowInfo[pRowNumber]) {
            return gRowInfo[pRowNumber];
        } else {
            return {
                y : (gEntityHeight + (1.5 * gArcRowHeight)) + pRowNumber * gArcRowHeight,
                height : gArcRowHeight
            };
        }
    }

    /**
     * setRowInfo() - stores the pHeight and y position pY for the given pRowNumber
     * - If the caller does not provide pHeight, the function sets the height to
     * the current default arc row height
     * - If the caller does not provide pY, the function calculates from the row height
     * and the y position (and height) of the previous row
     *
     * @param <int> pRowNumber
     * @param <int> pHeight
     * @param <int> pY
     */
    function setRowInfo(pRowNumber, pHeight, pY) {
        if (pHeight === undefined || pHeight < gArcRowHeight) {
            pHeight = gArcRowHeight;
        }
        if (pY === undefined) {
            var lPreviousRowInfo = getRowInfo(pRowNumber - 1);
            if (lPreviousRowInfo && lPreviousRowInfo.y > 0) {
                pY = lPreviousRowInfo.y + (lPreviousRowInfo.height + pHeight) / 2;
            } else {// TODO: this might be overkill
                pY = (gEntityHeight + (1.5 * gArcRowHeight)) + pRowNumber * gArcRowHeight;
            }
        }
        gRowInfo[pRowNumber] = {
            y : pY,
            height : pHeight
        };
    }

    /* ---------------end row memory ---------------------- */

    function _clean(pParentElementId, pWindow) {
        gDocument = skel.init(pWindow);
        var lChildElement = gDocument.getElementById(INNERELEMENTPREFIX + pParentElementId);
        if (lChildElement && (lChildElement !== null) && (lChildElement !== undefined)) {
            var lParentElement = gDocument.getElementById(pParentElementId);
            lParentElement.removeChild(lChildElement);
        }
    }

    /**
     * preProcessOptions() -
     * - resets the global variables governing entity width and height,
     *   row height to their default values
     * - modifies them if passed
     *   - hscale (influences the entity width and inter entity spacing defaults)
     *   - arcgradient (influences the arc row height, sets the global arc gradient)
     *   - wordwraparcs (sets the wordwraparcs global)
     *
     * Note that width is not processed here as this can only be done
     * reliably after most rendering calculations have been executed.
     *
     * @param <object> - pOptions - the option part of the AST
     */
    function preProcessOptions(pOptions) {
        gInterEntitySpacing = DEFAULT_INTER_ENTITY_SPACING;
        gEntityHeight = DEFAULT_ENTITY_HEIGHT;
        gEntityWidth = DEFAULT_ENTITY_WIDTH;
        gArcRowHeight = DEFAULT_ARCROW_HEIGHT;
        gArcGradient = DEFAULT_ARC_GRADIENT;
        gWordWrapArcs = false;

        if (pOptions) {
            if (pOptions.hscale) {
                gInterEntitySpacing = pOptions.hscale * DEFAULT_INTER_ENTITY_SPACING;
                gEntityWidth = pOptions.hscale * DEFAULT_ENTITY_WIDTH;
            }
            if (pOptions.arcgradient) {
                gArcRowHeight = parseInt(pOptions.arcgradient, 10) + DEFAULT_ARCROW_HEIGHT;
                gArcGradient = parseInt(pOptions.arcgradient, 10) + DEFAULT_ARC_GRADIENT;
            }
            if (pOptions.wordwraparcs && pOptions.wordwraparcs === "true") {
                gWordWrapArcs = true;
            }
        }
    }


    function toId (pElementIdentifierString){
        return gInnerElementId + pElementIdentifierString;
    }
    /**
     */
    function _renderAST(pAST, pSource, pParentElementId, pWindow) {

        /* process the AST so it is simpler to render */
        pAST = flatten.flatten(pAST);

        gInnerElementId = INNERELEMENTPREFIX + pParentElementId;
        
        skel.bootstrap(pParentElementId, gInnerElementId, pWindow);
        gDocument = skel.init(pWindow);
        defs = gDocument.getElementById(toId("__defs"));
        lifelinelayer = gDocument.getElementById(toId("__lifelinelayer"));
        sequence = gDocument.getElementById(toId("__sequencelayer"));
        notelayer = gDocument.getElementById(toId("__notelayer"));
        arcspanlayer = gDocument.getElementById(toId("__arcspanlayer"));
        
        gTextHeight = utl.getBBox(utl.createText("ÁjyÎ9ƒ@", 0, 0)).height;
        preProcessOptions(pAST.options);

        /* if there's nesting, make sure the rendering routines take the
         * extra width needed into account
         */
        var lMscDepthCorrection = 0;
        gMaxDepth = 0;
        if (pAST.depth) {
            lMscDepthCorrection = 2 * ((pAST.depth + 1) * 2 * LINE_WIDTH);
            gMaxDepth = pAST.depth;
        }
                
        /* render entities and arcs */
        renderEntities(pAST.entities);
        renderArcRows(pAST.arcs, pAST.entities);
        
        var lCanvasWidth = (pAST.entities.length * gInterEntitySpacing) + lMscDepthCorrection;

        var lNoArcs = pAST.arcs ? pAST.arcs.length : 0;
        var lRowInfo = getRowInfo(lNoArcs - 1);

        var lCanvasHeight = lRowInfo.y + (lRowInfo.height / 2) + 2 * PAD_VERTICAL;
        var lHorizontalTransform = (gInterEntitySpacing + lMscDepthCorrection - gEntityWidth) / 2;
        var lVerticalTransform = PAD_VERTICAL;
        var lScale = 1;

        /* embed the source code */
        // TODO: factor down
        if (pSource) {
            var lDescription = gDocument.getElementById(toId("__msc_source"));
            var lContent = gDocument.createTextNode("\n\n# Generated by mscgen_js - http://sverweij.github.io/mscgen_js\n" + pSource);
            lDescription.appendChild(lContent);
        }

        /* canvg ignores the background-color on svg level and makes the background
         * transparent in stead. To work around this insert a white rectangle the size
         * of the canvas in the background layer.
         *
         * We do this _before_ scaling is applied to the svg
         */
        var lBgGroup = gDocument.getElementById(toId("__background"));
        var lBgRect = utl.createRect(lCanvasWidth, lCanvasHeight, "bglayer", 0 - lHorizontalTransform, 0 - lVerticalTransform);
        lBgGroup.appendChild(lBgRect);
        
        /* render a watermark */
        if (pAST.options && pAST.options.watermark) {
            var lWaterMarkLayer = gDocument.getElementById(toId("__watermark"));
            var lWatermark = utl.createText(pAST.options.watermark, lCanvasWidth/2, lCanvasHeight/2, "watermark");
            var lAngle = 0 - (Math.atan(lCanvasHeight/lCanvasWidth) * 360/(2*Math.PI));
            lWatermark.setAttribute("transform", "rotate(" + lAngle.toString() + " " +  ((lCanvasWidth)/2).toString() + " " +  ((lCanvasHeight)/2).toString() +")");
            lWaterMarkLayer.appendChild(lWatermark);
        }

        /* options: post-processing */
        if (pAST.options && pAST.options.width) {
            lScale = (pAST.options.width / lCanvasWidth);
            lCanvasWidth *= lScale;
            lCanvasHeight *= lScale;
            lHorizontalTransform *= lScale;
            lVerticalTransform *= lScale;
        }

        // TODO: tight coupling
        var lSvgElement = gDocument.getElementById(gInnerElementId);
        var body = gDocument.getElementById(toId("__body"));
        body.setAttribute("transform", "translate(" + lHorizontalTransform + "," + lVerticalTransform + ")" + " scale(" + lScale + "," + lScale + ")");
        lSvgElement.setAttribute("width", lCanvasWidth.toString());
        lSvgElement.setAttribute("height", lCanvasHeight.toString());
    }

    /**
     * getMaxEntityHeight() -
     * crude method for determining the max entity height; create all entities,
     * measure the max, and than re-render using the max thus gotten
     *
     * @param <object> - pEntities - the entities subtree of the AST
     * @return <int> - height - the height of the heighest entity
     */

    function getMaxEntityHeight(pEntities) {
        var lHWM = gEntityHeight;
        var lHeight = gEntityHeight;
        pEntities.forEach(function(pEntity){
            lHeight = utl.getBBox(renderEntity(pEntity.name, pEntity)).height;
            if (lHeight > lHWM) {
                lHWM = lHeight;
            }
        });
        return lHWM;
    }
    
    function renderEntity(pId, pEntity) {
        var lGroup = utl.createGroup(pId);
        var lTextLabel = createTextLabel(pId + "_txt", pEntity, 0, gEntityHeight / 2, gEntityWidth, "entity");
        var lRect = utl.createRect(gEntityWidth, gEntityHeight);
        colorBox(lRect, pEntity);
        lGroup.appendChild(lRect);
        lGroup.appendChild(lTextLabel);
        return lGroup;
    }
    
    function _renderEntity(pEntity, pEntityXPos) {
        var arcColors = {};
        
        defs.appendChild(renderEntity(toId(pEntity.name), pEntity));
        sequence.appendChild(utl.createUse(pEntityXPos, 0, toId(pEntity.name)));
        gEntity2X[pEntity.name] = pEntityXPos + (gEntityWidth / 2);
        
        if (pEntity.arclinecolor) {
            arcColors.arclinecolor = pEntity.arclinecolor;
        }
        if (pEntity.arctextcolor) {
            arcColors.arctextcolor = pEntity.arctextcolor;
        }
        if (pEntity.arctextbgcolor) {
            arcColors.arctextbgcolor = pEntity.arctextbgcolor;
        }
        gEntity2ArcColor[pEntity.name] = arcColors;
    }

    /**
     * renderEntities() - renders the given pEntities (subtree of the AST) into
     * the sequence layer
     *
     * @param <object> - pEntities - the entities to render
     */
    function renderEntities(pEntities) {
        var lEntityXPos = 0;

        gEntity2X = {};
        gEntity2ArcColor = {};

        if (pEntities) {
            gEntityHeight = getMaxEntityHeight(pEntities) + LINE_WIDTH * 2;
            pEntities.forEach(function(pEntity){
                 _renderEntity(pEntity, lEntityXPos);
                lEntityXPos += gInterEntitySpacing;
            });
        }
        gEntityXHWM = lEntityXPos;
    }

    /** renderArcRows() - renders the arcrows from an AST
     *
     * @param <object> - pArcRows - the arc rows to render
     * @param <object> - pEntities - the entities to consider
     */
    function renderArcRows(pArcRows, pEntities) {
        var lInlineExpressionMemory = [];

        var lLabel = "";
        var lArcEnd = gEntityXHWM - gInterEntitySpacing + gEntityWidth;

        defs.appendChild(renderLifeLines(pEntities, toId("arcrow")));
        lifelinelayer.appendChild(utl.createUse(0, getRowInfo(-1).y, toId("arcrow")));

        clearRowInfo();
        if (pArcRows) {
            pArcRows.forEach(function(pArcRow, pRowNumber){
                var lArcRowOmit = false;
                var lRowMemory = [];
                setRowInfo(pRowNumber);
                /* render each arc in the row */
                pArcRow.forEach(function(pArc,pArcNumber){
                    var lCurrentId = toId(pRowNumber.toString() + "_" + pArcNumber.toString());
                    var lElement;
                    lLabel = "";
                    if (pArc.label) {
                        lLabel = pArc.label;
                    }
                    switch(map.getAggregate(pArc.kind)) {
                        case("emptyarc"):
                            lElement = renderEmptyArc(pArc, lCurrentId);
                            lArcRowOmit = ("..." === pArc.kind);
                            lRowMemory.push({
                                id : lCurrentId,
                                layer : sequence
                            });
                            break;
                        case("box"):
                            lElement = createBox(lCurrentId, gEntity2X[pArc.from], gEntity2X[pArc.to], pArc);
                            lRowMemory.push({
                                id : lCurrentId,
                                layer : notelayer
                            });
                            break;
                        case("inline_expression"):
                            lElement = renderInlineExpressionLabel(lCurrentId + "_label", pArc);
                            lRowMemory.push({
                                id : lCurrentId + "_label",
                                layer : notelayer
                            });
                            lInlineExpressionMemory.push({
                                id : lCurrentId,
                                arc : pArc,
                                rownum : pRowNumber
                            });
                            break;
                        default:
                            if (pArc.from && pArc.to) {
                                var lFrom = pArc.from;
                                var lTo = pArc.to;
                                var xTo = 0;
                                var xFrom = 0;

                                if (lTo === "*") {// it's a broadcast arc
                                    xFrom = gEntity2X[lFrom];
                                    pEntities.forEach(function(pEntity, pEntityNumber){
                                        if (pEntity.name != lFrom) {
                                            xTo = gEntity2X[pEntity.name];
                                            pArc.label = "";
                                            defs.appendChild(createArc(lCurrentId + "bc" + pEntityNumber, pArc, xFrom, xTo));
                                            lRowMemory.push({
                                                id : lCurrentId + "bc" + pEntityNumber,
                                                layer : sequence
                                            });
                                        }
                                    });
                                    pArc.label = lLabel;

                                    lElement = createTextLabel(lCurrentId + "_txt", pArc, 0, 0 - (gTextHeight / 2) - LINE_WIDTH, lArcEnd);
                                    lRowMemory.push({
                                        id : lCurrentId + "_txt",
                                        layer : sequence
                                    });
                                } else {// it's a regular arc
                                    xFrom = gEntity2X[lFrom];
                                    xTo = gEntity2X[lTo];
                                    lElement = createArc(lCurrentId, pArc, xFrom, xTo);
                                    lRowMemory.push({
                                        id : lCurrentId,
                                        layer : sequence
                                    });
                                }  /// lTo or lFrom === "*"
                            }// if both a from and a to
                            break;
                    }// switch
                    if (lElement) {
                        setRowInfo(pRowNumber, Math.max(getRowInfo(pRowNumber).height, utl.getBBox(lElement).height + 2 * LINE_WIDTH));
                        defs.appendChild(lElement);
                    }
                });// for all arcs in a row

                /*
                 *  only here we can determine the height of the row and the y position
                 */
                var lArcRowId = "arcrow_" + pRowNumber.toString();
                var lArcRowClass = "arcrow";
                if (lArcRowOmit) {
                    lArcRowClass = "arcrowomit";
                }
                defs.appendChild(renderLifeLines(pEntities, lArcRowClass, getRowInfo(pRowNumber).height, toId(lArcRowId)));
                lifelinelayer.appendChild(utl.createUse(0, getRowInfo(pRowNumber).y, toId(lArcRowId)));

                lRowMemory.forEach(function(pRowMemoryLine){
                    pRowMemoryLine.layer.appendChild(utl.createUse(0, getRowInfo(pRowNumber).y, pRowMemoryLine.id));
                });
            }); // for all rows
            renderInlineExpressions(lInlineExpressionMemory);
        } // if pArcRows
    }// function

    /**
     * renderInlineExpressionLabel() - renders the label of an inline expression
     * (/ arc spanning arc)
     *
     * @param <string> pId - the id to use for the rendered Element
     * @param <object> pArc - the arc spanning arc
     */
    function renderInlineExpressionLabel(pId, pArc) {
        var lFrom = gEntity2X[pArc.from];
        var lTo = gEntity2X[pArc.to];
        var FOLD_SIZE = 7;
        if (lFrom > lTo) {
            var lTmp = lFrom;
            lFrom = lTo;
            lTo = lTmp;
        }

        var lMaxWidth = (lTo - lFrom) + (gInterEntitySpacing - 2 * LINE_WIDTH) - FOLD_SIZE - LINE_WIDTH;

        var lStart = (lFrom - ((gInterEntitySpacing - 3 * LINE_WIDTH) / 2) - (gMaxDepth - pArc.depth) * 2 * LINE_WIDTH);
        var lGroup = utl.createGroup(pId);
        pArc.label = pArc.kind + (pArc.label ? ": " + pArc.label : "");
        var lTextGroup = createTextLabel(pId + "_txt", pArc, lStart + LINE_WIDTH - (lMaxWidth / 2), gArcRowHeight / 4, lMaxWidth, "anchor-start" /*, class */);
        var lBBox = utl.getBBox(lTextGroup);

        var lHeight = Math.max(lBBox.height + 2 * LINE_WIDTH, (gArcRowHeight / 2) - 2 * LINE_WIDTH);
        var lWidth = Math.min(lBBox.width + 2 * LINE_WIDTH, lMaxWidth);

        var lBox = utl.createEdgeRemark(lWidth - LINE_WIDTH + FOLD_SIZE, lHeight, "box", lStart, 0, FOLD_SIZE);
        colorBox(lBox, pArc);
        lGroup.appendChild(lBox);
        lGroup.appendChild(lTextGroup);

        return lGroup;
    }

    function renderInlineExpressions(pInlineExpressions) {
        pInlineExpressions.forEach(function(pInlineExpression){
            defs.appendChild(renderInlineExpression(pInlineExpression));
            arcspanlayer.appendChild(utl.createUse(0, getRowInfo(pInlineExpression.rownum).y, pInlineExpression.id));
        });
    }

    function renderInlineExpression(pArcMem) {
        var lFromY = getRowInfo(pArcMem.rownum).y;
        var lToY = getRowInfo(pArcMem.rownum + pArcMem.arc.numberofrows + 1).y;
        var lHeight = lToY - lFromY;
        pArcMem.arc.label = "";

        return createBox(pArcMem.id, gEntity2X[pArcMem.arc.from], gEntity2X[pArcMem.arc.to], pArcMem.arc, lHeight);
    }

    function renderLifeLines(pEntities, pClass, pHeight, pId) {
        if ((pId === undefined) || (pId === null)) {
            pId = pClass;
        }
        if ((pHeight === undefined) || (pHeight === null) || pHeight < gArcRowHeight) {
            pHeight = gArcRowHeight;
        }
        var lGroup = utl.createGroup(pId);
        var lEntityXPos = 0;

        pEntities.forEach(function(pEntity) {
            var lLine = utl.createLine(lEntityXPos + (gEntityWidth / 2), 0 - (pHeight / 2), lEntityXPos + (gEntityWidth / 2), (pHeight / 2), pClass);
            // TODO #13: render associated marker(s) in <def>
            if (pEntity.linecolor) {
                lLine.setAttribute("style", "stroke : " + pEntity.linecolor + ";");
                // TODO #13: color the associated marker(s)
            }
            lGroup.appendChild(lLine);
            lEntityXPos += gInterEntitySpacing;
        });

        return lGroup;
    }

   function createSelfRefArc(pClass, pFrom, pYTo, pDouble, pLineColor) {
        var lHeight = 2 * (gArcRowHeight / 5);
        var lWidth = gInterEntitySpacing / 3;

        var lGroup = utl.createGroup("selfie");
        if (pDouble) {
            // TODO #13: render associated marker(s) in <def>
            var lInnerTurn = utl.createUTurn(pFrom, (lHeight - 4) / 2, (pYTo - 2 + lHeight)/*lSign*lHeight*/, lWidth - 4, "none");
            var lOuterTurn = utl.createUTurn(pFrom, (lHeight + 4) / 2, (pYTo + 6 + lHeight)/*lSign*lHeight*/, lWidth, pClass);
            if (pLineColor) {
                lInnerTurn.setAttribute("style", "stroke: " + pLineColor + ";");
                lOuterTurn.setAttribute("style", "stroke: " + pLineColor + ";");
            }
            lGroup.appendChild(lInnerTurn);
            lGroup.appendChild(lOuterTurn);
        } else {
            var lUTurn = utl.createUTurn(pFrom, lHeight / 2, (pYTo + lHeight)/*lSign*lHeight*/, lWidth, pClass);
            if (pLineColor) {
                lUTurn.setAttribute("style", "stroke: " + pLineColor + ";");
            }
            lGroup.appendChild(lUTurn);
        }

        return lGroup;
    }

    function renderEmptyArc(pArc, pId) {
        var lElement;

        if (pArc.from && pArc.to) {
            if (gEntity2X[pArc.from] > gEntity2X[pArc.to]) {
                var lTmp = pArc.from;
                pArc.from = pArc.to;
                pArc.to = lTmp;
            }
        }

        switch(pArc.kind) {
            case ("..."):
            case ("|||"):
                lElement = createLifeLinesText(pId, pArc);
                break;
            case ("---"):
                lElement = createComment(pId, pArc);
                break;
        }
        return lElement;
    }

    function createArc(pId, pArc, pFrom, pTo) {
        var lGroup = utl.createGroup(pId);
        var lClass = "";
        var lArcGradient = gArcGradient;
        var lDoubleLine = (":>" === pArc.kind ) || ("::" === pArc.kind ) || ("<:>" === pArc.kind );

        lClass = map.determineArcClass(pArc.kind, pFrom, pTo);

        if ("-x" === pArc.kind) {
            pTo = pFrom + (pTo - pFrom) * (3 / 4);
        }

        var lYTo = 0;
        if (pArc.arcskip) {
            /* TODO: derive from hashmap */
            lYTo = pArc.arcskip * gArcRowHeight;
            lArcGradient = lYTo;
        }

        /* for one line labels add an end of line so it gets
         * rendered above the arc in stead of directly on it.
         * TODO: kludgy
         */
        if (pArc.label && (pArc.label.indexOf('\\n') === -1)) {
            pArc.label += "\\n";
        }

        if (pFrom === pTo) {
            lGroup.appendChild(createSelfRefArc(lClass, pFrom, lYTo, lDoubleLine, pArc.linecolor));
            lGroup.appendChild(createTextLabel(pId + "_txt", pArc, pFrom + 2 - (gInterEntitySpacing / 2), 0 - (gArcRowHeight / 5), gInterEntitySpacing, "anchor-start"));
        } else {
            var lLine = utl.createLine(pFrom, 0, pTo, lArcGradient, lClass, lDoubleLine);
            if (pArc.linecolor) {
                lLine.setAttribute("style", "stroke:" + pArc.linecolor + "; fill: " + pArc.linecolor + ";");
            }
            lGroup.appendChild(lLine);
            lGroup.appendChild(createTextLabel(pId + "_txt", pArc, pFrom, 0, pTo - pFrom));
        }
        return lGroup;
    }

    /**
     * splitLabel () - splits the given pLabel into an array of strings
     * - if the arc kind passed is a box the split occurs regardless
     * - if the arc kind passed is something else, the split occurs
     *   only if the _word wrap arcs_ option is true.
     *
     * @param <string> - pLabel
     * @param <string> - pKind
     * @param <number> - pWidth
     * @return <array of strings> - lLines
     */
    function splitLabel(pLabel, pKind, pWidth) {
        var lLines = pLabel.split('\\n');
        var lMaxTextWidthInChars = txt.determineMaxTextWidth(pWidth);
        switch(pKind) {
            case("box"):
            case("rbox"):
            case("abox"):
            case("note"):
            case(undefined):
                lLines = txt.wrap(pLabel, lMaxTextWidthInChars);
                break;
            default:
                if (gWordWrapArcs) {
                    lLines = txt.wrap(pLabel, lMaxTextWidthInChars);
                }
        }
        return lLines;
    }

    function renderTextLabelLine(pGroup, pLine, pMiddle, pStartY, pClass, pArc, pPosition) {
        var lGroup = pGroup;
        var lText = {};
        if (pPosition === 0) {
            lText = utl.createText(pLine, pMiddle, pStartY + gTextHeight / 4 + (pPosition * gTextHeight), pClass, pArc.url, pArc.id, pArc.idurl);
        } else {
            lText = utl.createText(pLine, pMiddle, pStartY + gTextHeight / 4 + (pPosition * gTextHeight), pClass, pArc.url);
        }
        var lBBox = utl.getBBox(lText);

        var lRect = utl.createRect(lBBox.width, lBBox.height, "textbg", lBBox.x, lBBox.y);
        colorText(lText, pArc);
        if (pArc.textbgcolor) {
            lRect.setAttribute("style", "fill: " + pArc.textbgcolor + "; stroke:" + pArc.textbgcolor + ";");
        }
        if (pArc.url && !pArc.textcolor) {
            pArc.textcolor = "blue";
            colorText(lText, pArc);
        }
        lGroup.appendChild(lRect);
        lGroup.appendChild(lText);
        return lGroup;
    }

    /**
     * createTextLabel() - renders the text (label, id, url) for a given pArc
     * with a bounding box starting at pStartX, pStartY and of a width of at
     * most pWidth (all in pixels)
     *
     * @param <string> - pId - the unique identification of the textlabe (group) within the svg
     * @param <objec> - pArc - the arc of which to render the text
     * @param <number> - pStartX
     * @param <number> - pStartY
     * @param <number> - pWidth
     * @param <string> - pClass - reference to a css class to influence text appearance
     */
    function createTextLabel(pId, pArc, pStartX, pStartY, pWidth, pClass) {
        var lGroup = utl.createGroup(pId);
        /* pArc:
         *   label & id
         *   url & idurl
         *   kind (boxes get auto wrapped)
         */

        if (pArc.label) {
            var lMiddle = pStartX + (pWidth / 2);
            pArc.label = txt.unescapeString(pArc.label);
            if (pArc.id) {
                pArc.id = txt.unescapeString(pArc.id);
            }
            var lLines = splitLabel(pArc.label, pArc.kind, pWidth);

            var lStartY = pStartY - (((lLines.length - 1) * gTextHeight) / 2) - ((lLines.length - 1) / 2);
            lLines.forEach(function(pLine, pLineNumber){
                lGroup = renderTextLabelLine(lGroup, pLine, lMiddle, lStartY, pClass, pArc, pLineNumber);
                lStartY++;
            });
        }
        return lGroup;
    }

    /**
     * createLifeLinesText() - creates centered text for the current (most
     *     possibly empty) arc. If the arc has a from and a to, the function
     *     centers between these, otherwise it does so from 0 to the width of
     *     the rendered chart
     *
     * @param <string> - pId - unique identification of the text in the svg
     * @param <object> - pArc - the arc to render
     */
    function createLifeLinesText(pId, pArc) {
        var lArcStart = 0;
        var lArcEnd = gEntityXHWM - gInterEntitySpacing + gEntityWidth;
        var lGroup = utl.createGroup(pId);

        if (pArc.from && pArc.to) {
            lArcStart = gEntity2X[pArc.from];
            lArcEnd = Math.abs(gEntity2X[pArc.to] - gEntity2X[pArc.from]);
        }
        lGroup.appendChild(createTextLabel(pId, pArc, lArcStart, 0, lArcEnd));
        return lGroup;
    }

    /**
     * createComment() - creates an element representing a comment ('---')
     *
     * @param <string> - pId - the unique identification of the comment within the svg
     * @param <object> - pArc - the (comment) arc to render
     */
    function createComment(pId, pArc) {
        var lStartX = 0;
        var lEndX = gEntityXHWM - gInterEntitySpacing + gEntityWidth;
        var lClass = "dotted";
        var lGroup = utl.createGroup(pId);

        if (pArc.from && pArc.to) {
            var lArcDepthCorrection = (gMaxDepth - pArc.depth) * 2 * LINE_WIDTH;

            lStartX = (gEntity2X[pArc.from] - (gInterEntitySpacing + 2 * LINE_WIDTH) / 2) - lArcDepthCorrection;
            lEndX = (gEntity2X[pArc.to] + (gInterEntitySpacing + 2 * LINE_WIDTH) / 2) + lArcDepthCorrection;
            lClass = "striped";
        }
        var lLine = utl.createLine(lStartX, 0, lEndX, 0, lClass);

        lGroup.appendChild(lLine);
        lGroup.appendChild(createLifeLinesText(pId + "_txt", pArc));

        if (pArc.linecolor) {
            lLine.setAttribute("style", "stroke: " + pArc.linecolor + ";");
        }

        return lGroup;
    }

    /**
     * Sets the fill color of the passed pElement to the textcolor of
     * the given pArc
     *
     * @param <svgElement> pElement
     * @param <object> pArc
     */
    function colorText(pElement, pArc) {
        if (pArc.textcolor) {
            var lStyleString = "";
            lStyleString += "fill:" + pArc.textcolor + ";";
            pElement.setAttribute("style", lStyleString);
        }
    }

    /**
     * colorBox() - sets the fill and stroke color of the element to the
     * textbgcolor and linecolor of the given arc
     *
     * @param <svg element> - pElemeent
     * @param <object> - pArc
     */
    function colorBox(pElement, pArc) {
        var lStyleString = "";
        if (pArc.textbgcolor) {
            lStyleString += "fill:" + pArc.textbgcolor + ";";
        }
        if (pArc.linecolor) {
            lStyleString += "stroke:" + pArc.linecolor + ";";
        }
        pElement.setAttribute("style", lStyleString);
    }

    /**
     * creates an element representing a box (box, abox, rbox, note)
     * also (mis?) used for rendering inline expressions/ arc spanning arcs
     *
     * @param <string> - pId - the unique identification of the box within the svg
     * @param <number> - pFrom - the x coordinate to render the box from
     * @param <number> - pTo - the x coordinate to render te box to
     * @param <object> - pArc - the (box/ arc spanning) arc to render
     * @param <number> - pHeight - the height of the box to render. If not passed
     * takes the bounding box of the (rendered) label of the arc, taking care not
     * to get smaller than the default arc row height
     */
    function createBox(pId, pFrom, pTo, pArc, pHeight) {
        if (pFrom > pTo) {
            var lTmp = pFrom;
            pFrom = pTo;
            pTo = lTmp;
        }
        var lWidth = ((pTo - pFrom) + gInterEntitySpacing - 2 * LINE_WIDTH);
        var NOTE_FOLD_SIZE = 9;
        // px
        var RBOX_CORNER_RADIUS = 6;
        // px

        var lStart = (pFrom - ((gInterEntitySpacing - 2 * LINE_WIDTH) / 2));
        var lGroup = utl.createGroup(pId);
        var lBox;
        var lTextGroup = createTextLabel(pId + "_txt", pArc, lStart, 0, lWidth);
        var lBBox = utl.getBBox(lTextGroup);

        var lHeight = pHeight ? pHeight : Math.max(lBBox.height + 2 * LINE_WIDTH, gArcRowHeight - 2 * LINE_WIDTH);

        switch (pArc.kind) {
            case ("box") :
                lBox = utl.createRect(lWidth, lHeight, "box", lStart, (0 - lHeight / 2));
                break;
            case ("rbox") :
                lBox = utl.createRect(lWidth, lHeight, "box", lStart, (0 - lHeight / 2), RBOX_CORNER_RADIUS, RBOX_CORNER_RADIUS);
                break;
            case ("abox") :
                lBox = utl.createABox(lWidth, lHeight, "box", lStart, 0);
                break;
            case ("note") :
                lBox = utl.createNote(lWidth, lHeight, "box", lStart, (0 - lHeight / 2), NOTE_FOLD_SIZE);
                break;
            default :
                var lArcDepthCorrection = (gMaxDepth - pArc.depth ) * 2 * LINE_WIDTH;
                lBox = utl.createRect(lWidth + lArcDepthCorrection * 2, lHeight, "box", lStart - lArcDepthCorrection, 0);
        }
        colorBox(lBox, pArc);
        lGroup.appendChild(lBox);
        lGroup.appendChild(lTextGroup);

        return lGroup;
    }

    return {

        /**
         * removes the element with id gInnerElementId from the DOM
         *
         * @param - {string} pParentElementId - the element the element with
         * the id mentioned above is supposed to be residing in
         * @param - {window} pWindow - the browser window object
         *
         */
        clean : function(pParentElementId, pWindow) {
            _clean(pParentElementId, pWindow);
        },
        /**
         * renders the given abstract syntax tree pAST as svg
         * in the element with id pParentELementId in the window pWindow
         *
         * @param {object} pAST - the abstrac syntax tree
         * @param {string} pSource - the source msc to embed in the svg
         * @param {string} pParentElementId - the id of the parent element in which
         * to put the __svg_output element
         * @param {window} pWindow - the browser window to put the svg in
         */
        renderAST : function(pAST, pSource, pParentElementId, pWindow) {
            _renderAST(pAST, pSource, pParentElementId, pWindow);
        }
    };
});
// define
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */