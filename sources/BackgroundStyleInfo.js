/**
 * Handles parsing, caching, and detecting changes to background (and -pie-background) CSS
 * @constructor
 * @param {Element} el the target element
 */
PIE.BackgroundStyleInfo = (function() {
    function BackgroundStyleInfo( el ) {
        this.element = el;
    }
    PIE.Util.merge( BackgroundStyleInfo.prototype, PIE.StyleBase, {

        cssProperty: PIE.CSS_PREFIX + 'background',
        styleProperty: PIE.STYLE_PREFIX + 'Background',

        attachIdents: { 'scroll':1, 'fixed':1, 'local':1 },
        repeatIdents: { 'repeat-x':1, 'repeat-y':1, 'repeat':1, 'no-repeat':1 },
        originIdents: { 'padding-box':1, 'border-box':1, 'content-box':1 },
        clipIdents: { 'padding-box':1, 'border-box':1 },
        positionIdents: { 'top':1, 'right':1, 'bottom':1, 'left':1, 'center':1 },
        sizeIdents: { 'contain':1, 'cover':1 },

        /**
         * For background styles, we support the -pie-background property but fall back to the standard
         * backround* properties.  The reason we have to use the prefixed version is that IE natively
         * parses the standard properties and if it sees something it doesn't know how to parse, for example
         * multiple values or gradient definitions, it will throw that away and not make it available through
         * currentStyle.
         *
         * Format of return object:
         * {
         *     color: <PIE.Color>,
         *     images: [
         *         {
         *             type: 'image',
         *             url: 'image.png',
         *             repeat: <'no-repeat' | 'repeat-x' | 'repeat-y' | 'repeat'>,
         *             position: <PIE.BgPosition>,
         *             attachment: <'scroll' | 'fixed' | 'local'>,
         *             origin: <'border-box' | 'padding-box' | 'content-box'>,
         *             clip: <'border-box' | 'padding-box'>,
         *             size: <'contain' | 'cover' | { w: <'auto' | PIE.Length>, h: <'auto' | PIE.Length> }>
         *         },
         *         {
         *             type: 'linear-gradient',
         *             gradientStart: <PIE.BgPosition>,
         *             angle: <PIE.Angle>,
         *             stops: [
         *                 { color: <PIE.Color>, offset: <PIE.Length> },
         *                 { color: <PIE.Color>, offset: <PIE.Length> }, ...
         *             ]
         *         }
         *     ]
         * }
         * @param {String} css
         * @override
         */
        parseCss: function( css ) {
            var el = this.element,
                cs = el.currentStyle,
                rs = el.runtimeStyle,
                tokenizer, token, image,
                tok_type = PIE.Tokenizer.Type,
                type_length = tok_type.LENGTH,
                type_operator = tok_type.OPERATOR,
                type_ident = tok_type.IDENT,
                type_color = tok_type.COLOR,
                tokType, tokVal,
                positionIdents = this.positionIdents,
                gradient, stop,
                props = null;

            function isLengthOrPercent( token ) {
                return token.type === type_length || token.type === tok_type.PERCENT || ( token.type === tok_type.NUMBER && token.value === '0' );
            }

            function isBgPosToken( token ) {
                return isLengthOrPercent( token ) || ( token.type === type_ident && token.value in positionIdents );
            }

            function sizeToken( token ) {
                return ( isLengthOrPercent( token ) && new PIE.Length( token.value ) ) || ( token.value === 'auto' && 'auto' );
            }

            // If the CSS3-specific -pie-background property is present, parse it
            if( this.getCss3() ) {
                tokenizer = new PIE.Tokenizer( css );
                props = { images: [] };
                image = {};

                while( token = tokenizer.next() ) {
                    tokType = token.type;
                    tokVal = token.value;

                    if( !image.type && tokType === tok_type.FUNCTION && tokVal === 'linear-gradient(' ) {
                        gradient = { stops: [], type: 'linear-gradient' };
                        stop = {};
                        while( token = tokenizer.next() ) {
                            tokType = token.type;
                            tokVal = token.value;

                            // If we reached the end of the function and had at least 2 stops, flush the info
                            if( tokType === tok_type.CHARACTER && tokVal === ')' ) {
                                if( stop.color ) {
                                    gradient.stops.push( stop );
                                }
                                if( gradient.stops.length > 1 ) {
                                    PIE.Util.merge( image, gradient );
                                }
                                break;
                            }

                            // Color stop - must start with color
                            if( tokType === type_color ) {
                                // if we already have an angle/position, make sure that the previous token was a comma
                                if( gradient.angle || gradient.gradientStart ) {
                                    token = tokenizer.prev();
                                    if( token.type !== type_operator ) {
                                        break; //fail
                                    }
                                    tokenizer.next();
                                }

                                stop = {
                                    color: new PIE.Color( tokVal )
                                };
                                // check for offset following color
                                token = tokenizer.next();
                                if( isLengthOrPercent( token ) ) {
                                    stop.offset = new PIE.Length( token.value );
                                } else {
                                    tokenizer.prev();
                                }
                            }
                            // Angle - can only appear in first spot
                            else if( tokType === tok_type.ANGLE && !gradient.angle && !stop.color && !gradient.stops.length ) {
                                gradient.angle = new PIE.Angle( token.value );
                            }
                            else if( isBgPosToken( token ) && !gradient.gradientStart && !stop.color && !gradient.stops.length ) {
                                tokenizer.prev();
                                gradient.gradientStart = new PIE.BgPosition(
                                    tokenizer.until( function( t ) {
                                        return !isBgPosToken( t );
                                    }, false ).slice( 0, -1 )
                                );
                                tokenizer.prev();
                            }
                            else if( tokType === type_operator && tokVal === ',' ) {
                                if( stop.color ) {
                                    gradient.stops.push( stop );
                                    stop = {};
                                }
                            }
                            else {
                                // Found something we didn't recognize; fail without adding image
                                break;
                            }
                        }
                    }
                    else if( !image.type && tokType === tok_type.URL ) {
                        image.url = tokVal;
                        image.type = 'image';
                    }
                    else if( isBgPosToken( token ) && !image.size ) {
                        tokenizer.prev();
                        image.position = new PIE.BgPosition(
                            tokenizer.until( function( t ) {
                                return !isBgPosToken( t );
                            }, false ).slice( 0, -1 )
                        );
                        tokenizer.prev();
                    }
                    else if( tokType === type_ident ) {
                        if( tokVal in this.repeatIdents ) {
                            image.repeat = tokVal;
                        }
                        else if( tokVal in this.originIdents ) {
                            image.origin = tokVal;
                            if( tokVal in this.clipIdents ) {
                                image.clip = tokVal;
                            }
                        }
                        else if( tokVal in this.attachIdents ) {
                            image.attachment = tokVal;
                        }
                    }
                    else if( tokType === type_color && !props.color ) {
                        props.color = new PIE.Color( tokVal );
                    }
                    else if( tokType === type_operator ) {
                        // background size
                        if( tokVal === '/' ) {
                            token = tokenizer.next();
                            tokType = token.type;
                            tokVal = token.value;
                            if( tokType === type_ident && tokVal in this.sizeIdents ) {
                                image.size = tokVal;
                            }
                            else if( tokVal = sizeToken( token ) ) {
                                image.size = {
                                    w: tokVal,
                                    h: sizeToken( tokenizer.next() ) || ( tokenizer.prev() && tokVal )
                                };
                            }
                        }
                        // new layer
                        else if( tokVal === ',' && image.type ) {
                            props.images.push( image );
                            image = {};
                        }
                    }
                    else {
                        // Found something unrecognized; chuck everything
                        return null;
                    }
                }

                // leftovers
                if( image.type ) {
                    props.images.push( image );
                }
            }

            // Otherwise, use the standard background properties; let IE give us the values rather than parsing them
            else {
                this.withActualBg( function() {
                    var posX = cs.backgroundPositionX,
                        posY = cs.backgroundPositionY,
                        img = cs.backgroundImage,
                        color = cs.backgroundColor;

                    props = {};
                    if( color !== 'transparent' ) {
                        props.color = new PIE.Color( color )
                    }
                    if( img !== 'none' ) {
                        props.images = [ {
                            type: 'image',
                            url: img.replace( this.urlRE, "$1" ),
                            repeat: cs.backgroundRepeat,
                            position: new PIE.BgPosition( new PIE.Tokenizer( posX + ' ' + posY ).all() )
                        } ];
                    }
                } );
            }

            return props;
        },

        /**
         * Execute a function with the actual background styles (not overridden with runtimeStyle
         * properties set by the renderers) available via currentStyle.
         * @param fn
         */
        withActualBg: function( fn ) {
            var rs = this.element.runtimeStyle,
                rsImage = rs.backgroundImage,
                rsColor = rs.backgroundColor,
                ret;

            rs.backgroundImage = rs.backgroundColor = '';

            ret = fn.call( this );

            rs.backgroundImage = rsImage;
            rs.backgroundColor = rsColor;

            return ret;
        },

        getCss: function() {
            var cs = this.element.currentStyle;
            return this.getCss3() ||
                   this.withActualBg( function() {
                       return cs.backgroundColor + ' ' + cs.backgroundImage + ' ' + cs.backgroundRepeat + ' ' +
                       cs.backgroundPositionX + ' ' + cs.backgroundPositionY;
                   } );
        },

        getCss3: function() {
            var el = this.element;
            return el.style[ this.styleProperty ] || el.currentStyle.getAttribute( this.cssProperty );
        },

        /**
         * The isActive logic is slightly different, because getProps() always returns an object
         * even if it is just falling back to the native background properties.  But we only want
         * to report is as being "active" if the -pie-background override property is present and
         * parses successfully.
         */
        isActive: function() {
            return this.getCss3() && !!this.getProps();
        }

    } );

    return BackgroundStyleInfo;
})();