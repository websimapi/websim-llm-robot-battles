const { useState, useEffect, useRef } = React;
const { createRoot } = ReactDOM;

// Initialize WebSocket connection
const room = new WebsimSocket();

// Matter.js modules
const { Engine, Render, World, Bodies, Body, Events, Composite } = Matter;

const App = () => {
    const [activeTab, setActiveTab] = useState('create');
    const [botPrompt, setBotPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [myBots, setMyBots] = useState([]);
    const [allBots, setAllBots] = useState([]);
    const [selectedBot, setSelectedBot] = useState(null);
    const [opponent, setOpponent] = useState(null);
    const [battleActive, setBattleActive] = useState(false);
    const [battleLog, setBattleLog] = useState([]);
    const [battleStats, setBattleStats] = useState({
        player: { health: 100, score: 0 },
        opponent: { health: 100, score: 0 }
    });
    
    const engineRef = useRef(null);
    const rendererRef = useRef(null);
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const playerBotRef = useRef(null);
    const opponentBotRef = useRef(null);
    const battleLogRef = useRef(null);

    // Load bots on initial render
    useEffect(() => {
        loadMyBots();
        loadAllBots();
    }, []);

    // Scroll battle log to bottom when updated
    useEffect(() => {
        if (battleLogRef.current) {
            battleLogRef.current.scrollTop = battleLogRef.current.scrollHeight;
        }
    }, [battleLog]);

    // Load user's bots
    const loadMyBots = () => {
        const userBots = room.collection('robot').filter({ 
            creator_id: room.party.client.id 
        }).getList();
        setMyBots(userBots);

        // Subscribe to changes
        room.collection('robot').filter({ 
            creator_id: room.party.client.id 
        }).subscribe((bots) => {
            setMyBots(bots);
        });
    };

    // Load all available bots
    const loadAllBots = () => {
        const bots = room.collection('robot').getList();
        setAllBots(bots);

        // Subscribe to changes
        room.collection('robot').subscribe((bots) => {
            setAllBots(bots);
        });
    };

    // Generate a new bot
    const generateBot = async () => {
        if (botPrompt.length < 10) {
            alert("Please enter a more detailed prompt (at least 10 characters)");
            return;
        }
        
        if (botPrompt.length > 500) {
            alert("Prompt exceeds 500 character limit");
            return;
        }
        
        // Validate prompt (a-z only)
        if (!/^[a-zA-Z\s]+$/.test(botPrompt)) {
            alert("Prompt can only contain letters a-z and spaces");
            return;
        }
        
        setIsGenerating(true);
        
        try {
            // Call LLM to generate bot design
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are an AI that designs battle robots for a 2D physics-based arena. 
                        
                        RULES FOR ROBOT DESIGN:
                        1. Your design must use only Matter.js physics bodies (rectangles, circles, etc.)
                        2. The robot should have a main body and some moving parts
                        3. The robot can have properties like: health, speed, attack, defense, special abilities
                        4. The robot should have a color scheme and visual design
                        5. Each bot must have unique behaviors for attack and defense
                        
                        IMPORTANT: You must respond with valid JSON in exactly this format, with no additional text:
                        {
                            "name": "Robot name",
                            "description": "Brief description",
                            "color": "#hexcode",
                            "accentColor": "#hexcode",
                            "stats": {
                                "health": 100,
                                "speed": 5,
                                "attack": 7,
                                "defense": 4
                            },
                            "specialAbility": "Description of special move",
                            "design": {
                                "mainBody": { "type": "rectangle|circle", "width": 50, "height": 50, "radius": 25 },
                                "parts": [
                                    { "type": "rectangle|circle", "x": 30, "y": 0, "width": 20, "height": 10, "radius": 10, "angle": 0, "role": "weapon" }
                                ]
                            },
                            "behavior": {
                                "attackPattern": "Description of attack behavior",
                                "defensePattern": "Description of defense behavior"
                            }
                        }`
                    },
                    {
                        role: "user",
                        content: botPrompt
                    }
                ],
                json: true
            });
            
            let botDesign;
            try {
                botDesign = JSON.parse(completion.content);
            } catch (parseError) {
                console.error("Failed to parse bot JSON:", parseError);
                console.log("Raw content:", completion.content);
                throw new Error("Failed to generate valid bot design. Please try again with a different prompt.");
            }
            
            // Validate essential properties exist
            if (!botDesign.name || !botDesign.description || !botDesign.design || 
                !botDesign.design.mainBody || !botDesign.stats) {
                throw new Error("Generated bot design is missing essential properties");
            }
            
            // Save the bot to the database
            const newBot = await room.collection('robot').create({
                name: botDesign.name,
                description: botDesign.description,
                design: botDesign,
                prompt: botPrompt,
                creator_id: room.party.client.id,
                creator_username: room.party.client.username,
                wins: 0,
                losses: 0
            });
            
            // Switch to My Bots tab and select the new bot
            setActiveTab('mybots');
            setSelectedBot(newBot);
            setBotPrompt('');
            
        } catch (error) {
            console.error("Error generating bot:", error);
            alert("Failed to generate bot. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    // Initialize battle arena
    const initBattleArena = () => {
        if (!selectedBot || !opponent) return;
        
        // Clear previous engine and renderer
        if (engineRef.current) {
            World.clear(engineRef.current.world);
            Engine.clear(engineRef.current);
        }
        
        if (rendererRef.current) {
            Render.stop(rendererRef.current);
            rendererRef.current.canvas.remove();
            rendererRef.current = null;
        }
        
        // Setup physics engine
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = 400;
        
        // Create engine
        engineRef.current = Engine.create({
            gravity: { x: 0, y: 1 }
        });
        
        // Create renderer
        rendererRef.current = Render.create({
            element: containerRef.current,
            engine: engineRef.current,
            options: {
                width: containerWidth,
                height: containerHeight,
                wireframes: false,
                background: '#0a0a14'
            }
        });
        
        // Create arena boundaries
        const ground = Bodies.rectangle(containerWidth/2, containerHeight, containerWidth, 20, 
            { isStatic: true, render: { fillStyle: '#333' } });
        const leftWall = Bodies.rectangle(0, containerHeight/2, 20, containerHeight, 
            { isStatic: true, render: { fillStyle: '#333' } });
        const rightWall = Bodies.rectangle(containerWidth, containerHeight/2, 20, containerHeight, 
            { isStatic: true, render: { fillStyle: '#333' } });
        const ceiling = Bodies.rectangle(containerWidth/2, 0, containerWidth, 20, 
            { isStatic: true, render: { fillStyle: '#333' } });
        
        World.add(engineRef.current.world, [ground, leftWall, rightWall, ceiling]);
        
        // Create player bot
        playerBotRef.current = createBotBody(selectedBot.design, 
            containerWidth * 0.25, containerHeight * 0.7, true);
        
        // Create opponent bot
        opponentBotRef.current = createBotBody(opponent.design, 
            containerWidth * 0.75, containerHeight * 0.7, false);
        
        // Start the renderer
        Render.run(rendererRef.current);
        
        // Reset battle stats
        setBattleStats({
            player: { health: selectedBot.design.stats.health, score: 0 },
            opponent: { health: opponent.design.stats.health, score: 0 }
        });
        
        setBattleLog([{ text: "Battle starting...", type: "system" }]);
    };

    // Create bot body from design
    const createBotBody = (botDesign, x, y, isPlayer) => {
        const design = botDesign.design;
        const color = botDesign.color;
        const accentColor = botDesign.accentColor;
        
        const botParts = [];
        
        // Create main body
        let mainBody;
        if (design.mainBody.type === 'rectangle') {
            mainBody = Bodies.rectangle(
                x, 
                y, 
                design.mainBody.width, 
                design.mainBody.height, 
                { 
                    render: { fillStyle: color },
                    frictionAir: 0.05,
                    label: isPlayer ? 'playerBot' : 'opponentBot'
                }
            );
        } else {
            mainBody = Bodies.circle(
                x, 
                y, 
                design.mainBody.radius, 
                { 
                    render: { fillStyle: color },
                    frictionAir: 0.05,
                    label: isPlayer ? 'playerBot' : 'opponentBot'
                }
            );
        }
        
        botParts.push(mainBody);
        
        // Add other parts
        if (design.parts && design.parts.length > 0) {
            design.parts.forEach((part, index) => {
                let partBody;
                
                if (part.type === 'rectangle') {
                    partBody = Bodies.rectangle(
                        x + (isPlayer ? part.x : -part.x),
                        y + part.y,
                        part.width,
                        part.height,
                        {
                            render: { fillStyle: accentColor },
                            label: `${isPlayer ? 'player' : 'opponent'}_${part.role || 'part'}_${index}`
                        }
                    );
                    
                    if (part.angle) {
                        Body.rotate(partBody, part.angle * (Math.PI / 180));
                    }
                } else {
                    partBody = Bodies.circle(
                        x + (isPlayer ? part.x : -part.x),
                        y + part.y,
                        part.radius,
                        {
                            render: { fillStyle: accentColor },
                            label: `${isPlayer ? 'player' : 'opponent'}_${part.role || 'part'}_${index}`
                        }
                    );
                }
                
                botParts.push(partBody);
                
                // Create constraint to connect parts to main body if needed
                // This would be added for more complex bots
            });
        }
        
        const botComposite = Composite.create({ label: isPlayer ? 'playerComposite' : 'opponentComposite' });
        Composite.add(botComposite, botParts);
        World.add(engineRef.current.world, botComposite);
        
        return {
            mainBody,
            composite: botComposite,
            parts: botParts,
            design: botDesign
        };
    };

    // Start a battle
    const startBattle = () => {
        if (!selectedBot || !opponent) {
            alert("Please select your bot and an opponent");
            return;
        }
        
        initBattleArena();
        setBattleActive(true);
        
        // Run engine
        const engine = engineRef.current;
        
        // Set up battle loop
        const battleInterval = setInterval(() => {
            if (!battleActive) {
                clearInterval(battleInterval);
                return;
            }
            
            // Move bots based on their AI behavior
            moveBot(playerBotRef.current, true);
            moveBot(opponentBotRef.current, false);
            
            // Check for collisions and update health
            checkCollisions();
            
            // Check if battle is over
            if (battleStats.player.health <= 0 || battleStats.opponent.health <= 0) {
                endBattle(battleStats.player.health > battleStats.opponent.health);
                clearInterval(battleInterval);
            }
            
        }, 100);
        
        // Start physics engine
        const runner = Matter.Runner.create();
        Matter.Runner.run(runner, engine);
    };

    // Move bot based on AI behavior
    const moveBot = (bot, isPlayer) => {
        if (!bot || !bot.mainBody) return;
        
        const botDesign = bot.design;
        const speed = botDesign.stats.speed * 0.02;
        
        // Simple AI movement
        if (isPlayer) {
            // Player bot moves toward opponent
            const direction = playerBotRef.current.mainBody.position.x < opponentBotRef.current.mainBody.position.x ? 1 : -1;
            Body.applyForce(bot.mainBody, bot.mainBody.position, {
                x: direction * speed,
                y: -0.005 // Small upward force for jumping
            });
        } else {
            // Opponent bot moves toward player
            const direction = opponentBotRef.current.mainBody.position.x < playerBotRef.current.mainBody.position.x ? 1 : -1;
            Body.applyForce(bot.mainBody, bot.mainBody.position, {
                x: direction * speed,
                y: -0.005 // Small upward force for jumping
            });
        }
        
        // Special abilities based on robot design
        // This is simplified - could be expanded for more complex behaviors
        if (Math.random() < 0.05) { // 5% chance per update to use special ability
            const message = `${botDesign.name} uses ${botDesign.specialAbility}!`;
            setBattleLog(prev => [...prev, { text: message, type: isPlayer ? "player" : "opponent" }]);
            
            // Apply damage based on attack stat
            const damage = Math.floor(botDesign.stats.attack * (Math.random() * 2 + 0.5));
            
            if (isPlayer) {
                setBattleStats(prev => ({
                    ...prev,
                    opponent: {
                        ...prev.opponent,
                        health: Math.max(0, prev.opponent.health - damage)
                    }
                }));
                setBattleLog(prev => [...prev, { 
                    text: `${botDesign.name} deals ${damage} damage to ${opponent.name}!`,
                    type: "player"
                }]);
            } else {
                setBattleStats(prev => ({
                    ...prev,
                    player: {
                        ...prev.player,
                        health: Math.max(0, prev.player.health - damage)
                    }
                }));
                setBattleLog(prev => [...prev, { 
                    text: `${botDesign.name} deals ${damage} damage to ${selectedBot.name}!`,
                    type: "opponent"
                }]);
            }
        }
    };

    // Check for collisions between bots
    const checkCollisions = () => {
        if (!engineRef.current) return;
        
        // This would be expanded for more sophisticated collision detection
        // For example, detecting which parts are colliding and applying different effects
        
        Events.on(engineRef.current, 'collisionStart', (event) => {
            const pairs = event.pairs;
            
            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                
                // Check if collision is between player and opponent
                const playerPart = pair.bodyA.label.startsWith('player') ? pair.bodyA : 
                                    pair.bodyB.label.startsWith('player') ? pair.bodyB : null;
                                    
                const opponentPart = pair.bodyA.label.startsWith('opponent') ? pair.bodyA : 
                                    pair.bodyB.label.startsWith('opponent') ? pair.bodyB : null;
                
                if (playerPart && opponentPart) {
                    // Calculate damage based on velocity
                    const impactVelocity = Matter.Vector.magnitude(Matter.Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity));
                    const baseDamage = Math.floor(impactVelocity * 0.5);
                    
                    // Apply damage to both bots based on their defense stat
                    if (baseDamage > 1) {
                        const playerDamage = Math.max(1, Math.floor(baseDamage / (selectedBot.design.stats.defense * 0.5)));
                        const opponentDamage = Math.max(1, Math.floor(baseDamage / (opponent.design.stats.defense * 0.5)));
                        
                        setBattleStats(prev => ({
                            player: {
                                ...prev.player,
                                health: Math.max(0, prev.player.health - opponentDamage)
                            },
                            opponent: {
                                ...prev.opponent,
                                health: Math.max(0, prev.opponent.health - playerDamage)
                            }
                        }));
                        
                        setBattleLog(prev => [...prev, { 
                            text: `Impact! ${selectedBot.name} takes ${opponentDamage} damage, ${opponent.name} takes ${playerDamage} damage!`,
                            type: "system"
                        }]);
                    }
                }
            }
        });
    };

    // End battle and update stats
    const endBattle = async (playerWon) => {
        setBattleActive(false);
        
        // Update battle log
        setBattleLog(prev => [...prev, { 
            text: playerWon 
                ? `Victory! ${selectedBot.name} has defeated ${opponent.name}!` 
                : `Defeat! ${opponent.name} has defeated ${selectedBot.name}!`,
            type: "system"
        }]);
        
        // Update bot stats in database
        try {
            if (playerWon) {
                await room.collection('robot').update(selectedBot.id, {
                    wins: (selectedBot.wins || 0) + 1
                });
                
                await room.collection('robot').update(opponent.id, {
                    losses: (opponent.losses || 0) + 1
                });
            } else {
                await room.collection('robot').update(selectedBot.id, {
                    losses: (selectedBot.losses || 0) + 1
                });
                
                await room.collection('robot').update(opponent.id, {
                    wins: (opponent.wins || 0) + 1
                });
            }
            
            // Record battle result
            await room.collection('battle').create({
                player_bot_id: selectedBot.id,
                opponent_bot_id: opponent.id,
                winner_id: playerWon ? selectedBot.id : opponent.id,
                player_health_remaining: battleStats.player.health,
                opponent_health_remaining: battleStats.opponent.health
            });
            
        } catch (error) {
            console.error("Error updating battle stats:", error);
        }
    };

    // Reset battle
    const resetBattle = () => {
        setBattleActive(false);
        if (rendererRef.current) {
            Render.stop(rendererRef.current);
            rendererRef.current.canvas.remove();
            rendererRef.current = null;
        }
        setBattleLog([]);
        setBattleStats({
            player: { health: 100, score: 0 },
            opponent: { health: 100, score: 0 }
        });
    };

    // Calculate character count status
    const getCharacterCountStatus = () => {
        const count = botPrompt.length;
        if (count > 500) return { class: "error", text: `${count}/500 (exceeds limit)` };
        return { class: "", text: `${count}/500` };
    };

    // Render bot in a small preview canvas
    const renderBotPreview = (botDesign, canvasRef) => {
        if (!canvasRef.current || !botDesign) return;
        
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, width, height);
        
        const design = botDesign.design;
        const color = botDesign.color;
        const accentColor = botDesign.accentColor;
        
        // Center coordinates
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Draw main body
        ctx.fillStyle = color;
        if (design.mainBody.type === 'rectangle') {
            ctx.fillRect(
                centerX - design.mainBody.width / 2,
                centerY - design.mainBody.height / 2,
                design.mainBody.width,
                design.mainBody.height
            );
        } else {
            ctx.beginPath();
            ctx.arc(centerX, centerY, design.mainBody.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw parts
        if (design.parts && design.parts.length > 0) {
            ctx.fillStyle = accentColor;
            design.parts.forEach(part => {
                if (part.type === 'rectangle') {
                    // Save context for rotation
                    ctx.save();
                    // Translate to the center of the rectangle
                    ctx.translate(
                        centerX + part.x,
                        centerY + part.y
                    );
                    // Rotate
                    if (part.angle) {
                        ctx.rotate(part.angle * (Math.PI / 180));
                    }
                    // Draw the rectangle centered at the origin
                    ctx.fillRect(
                        -part.width / 2,
                        -part.height / 2,
                        part.width,
                        part.height
                    );
                    // Restore context
                    ctx.restore();
                } else {
                    ctx.beginPath();
                    ctx.arc(centerX + part.x, centerY + part.y, part.radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        }
    };

    // Render bot preview canvases using refs
    const BotPreview = ({ bot, onSelect, isSelected }) => {
        const previewRef = useRef(null);
        
        useEffect(() => {
            if (previewRef.current && bot.design) {
                renderBotPreview(bot.design, previewRef);
            }
        }, [bot, previewRef]);
        
        return (
            <div className={`bot-card ${isSelected ? 'selected' : ''}`} 
                onClick={() => onSelect(bot)}
                style={isSelected ? { border: '2px solid #4a4dff' } : {}}>
                <div className="bot-card-header">
                    <h3>{bot.name}</h3>
                    <div>W: {bot.wins || 0} / L: {bot.losses || 0}</div>
                </div>
                <div className="bot-preview">
                    <canvas ref={previewRef} width={150} height={150}></canvas>
                </div>
                <p>Creator: {bot.creator_username}</p>
                <p>{bot.description}</p>
            </div>
        );
    };

    return (
        <div className="container">
            <header>
                <h1>LLM Robot Battles</h1>
                <p>Create your robot, battle others, and climb the leaderboard!</p>
            </header>
            
            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'create' ? 'active' : ''}`}
                    onClick={() => setActiveTab('create')}>
                    Create New Bot
                </button>
                <button 
                    className={`tab ${activeTab === 'mybots' ? 'active' : ''}`}
                    onClick={() => setActiveTab('mybots')}>
                    My Bots
                </button>
                <button 
                    className={`tab ${activeTab === 'gallery' ? 'active' : ''}`}
                    onClick={() => setActiveTab('gallery')}>
                    Bot Gallery
                </button>
                <button 
                    className={`tab ${activeTab === 'battle' ? 'active' : ''}`}
                    onClick={() => setActiveTab('battle')}>
                    Battle Arena
                </button>
            </div>
            
            {activeTab === 'create' && (
                <div className="create-tab">
                    <h2>Create Your Battle Bot</h2>
                    <p>Enter a prompt (500 characters max, letters only) to generate your battle bot:</p>
                    
                    <div className="prompt-form">
                        <textarea 
                            value={botPrompt}
                            onChange={(e) => setBotPrompt(e.target.value)}
                            placeholder="Describe your battle bot. Be creative! The AI will design a robot based on your description..."
                            maxLength={500}
                        />
                        <div className={`character-count ${getCharacterCountStatus().class}`}>
                            {getCharacterCountStatus().text}
                        </div>
                        <button 
                            onClick={generateBot}
                            disabled={isGenerating || botPrompt.length < 10 || botPrompt.length > 500}>
                            {isGenerating ? 'Generating...' : 'Generate Bot'}
                        </button>
                    </div>
                </div>
            )}
            
            {activeTab === 'mybots' && (
                <div className="mybots-tab">
                    <h2>My Battle Bots</h2>
                    {myBots.length === 0 ? (
                        <p>You haven't created any bots yet. Go to the Create tab to make your first bot!</p>
                    ) : (
                        <div className="bot-gallery">
                            {myBots.map(bot => (
                                <BotPreview 
                                    key={bot.id} 
                                    bot={bot} 
                                    onSelect={(bot) => {
                                        setSelectedBot(bot);
                                        setActiveTab('battle');
                                    }}
                                    isSelected={selectedBot && selectedBot.id === bot.id}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
            
            {activeTab === 'gallery' && (
                <div className="gallery-tab">
                    <h2>Bot Gallery</h2>
                    {allBots.length === 0 ? (
                        <p>No bots have been created yet. Be the first to create one!</p>
                    ) : (
                        <div className="bot-gallery">
                            {allBots
                                .filter(bot => !myBots.some(myBot => myBot.id === bot.id))
                                .map(bot => (
                                    <BotPreview 
                                        key={bot.id} 
                                        bot={bot} 
                                        onSelect={(bot) => {
                                            setOpponent(bot);
                                            setActiveTab('battle');
                                        }}
                                        isSelected={opponent && opponent.id === bot.id}
                                    />
                                ))
                            }
                        </div>
                    )}
                </div>
            )}
            
            {activeTab === 'battle' && (
                <div className="battle-tab">
                    <h2>Battle Arena</h2>
                    
                    <div className="battle-selection">
                        <div className="battle-row">
                            <div className="battle-column">
                                <h3>Your Bot</h3>
                                {selectedBot ? (
                                    <div>
                                        <h4>{selectedBot.name}</h4>
                                        <p>{selectedBot.description}</p>
                                        <button onClick={() => setActiveTab('mybots')}>Change Bot</button>
                                    </div>
                                ) : (
                                    <div>
                                        <p>Select a bot from Your Bots</p>
                                        <button onClick={() => setActiveTab('mybots')}>Select Bot</button>
                                    </div>
                                )}
                            </div>
                            
                            <div className="battle-column">
                                <h3>Opponent</h3>
                                {opponent ? (
                                    <div>
                                        <h4>{opponent.name}</h4>
                                        <p>{opponent.description}</p>
                                        <button onClick={() => setActiveTab('gallery')}>Change Opponent</button>
                                    </div>
                                ) : (
                                    <div>
                                        <p>Select an opponent from the Gallery</p>
                                        <button onClick={() => setActiveTab('gallery')}>Select Opponent</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <div className="battle-controls">
                        <button 
                            onClick={startBattle}
                            disabled={!selectedBot || !opponent || battleActive}>
                            Start Battle
                        </button>
                        
                        <button 
                            onClick={resetBattle}
                            disabled={!battleActive}>
                            Reset Battle
                        </button>
                    </div>
                    
                    <div className="battle-stats">
                        <div className="stats-column">
                            <h3>{selectedBot ? selectedBot.name : 'Your Bot'}</h3>
                            <p>Health: {battleStats.player.health}</p>
                        </div>
                        <div className="stats-column">
                            <h3>VS</h3>
                        </div>
                        <div className="stats-column">
                            <h3>{opponent ? opponent.name : 'Opponent'}</h3>
                            <p>Health: {battleStats.opponent.health}</p>
                        </div>
                    </div>
                    
                    <div className="battle-arena" ref={containerRef}>
                        {/* Canvas will be inserted here by Matter.js */}
                    </div>
                    
                    <div className="battle-log" ref={battleLogRef}>
                        {battleLog.map((log, index) => (
                            <p key={index} style={{ 
                                color: log.type === 'player' ? '#4a4dff' : 
                                       log.type === 'opponent' ? '#ff4a4a' : '#ffffff' 
                            }}>
                                {log.text}
                            </p>
                        ))}
                    </div>
                </div>
            )}
            
            {isGenerating && (
                <div className="loading-overlay">
                    <div className="spinner"></div>
                    <p className="loading-text">Generating your battle bot...</p>
                </div>
            )}
        </div>
    );
};

// Render the app
const root = createRoot(document.getElementById('app'));
root.render(<App />);