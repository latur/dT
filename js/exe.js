"use strict";

var World = Matter.World;

var keys = [];
var sleep = document.getElementById('xsleep');
var xmap  = document.getElementById('xmap');

var map = {
	'ground' : './maps/mikapa/ground.jpg',
	'top'    : './maps/mikapa/top.png',
	'size'   : [1800, 1000],
};

var minimapHeight = 120 * map.size[1] / map.size[0];

$('#mini-map').css({ height : minimapHeight, display : 'block' });
$('#xmap').css({ width : map.size[0], height : map.size[1] })

// -------------------------------------------------------------------------- //

var engine = Matter.Engine.create();
var render = Matter.Render.create({
    element: xmap,
    engine: engine,
    options: {
	    width:  map.size[0], 
	    height: map.size[1], 
	    pixelRatio: 2, 
	    wireframes : false
    }
});

engine.world.gravity.x = 0;
engine.world.gravity.y = 0;

var unit_create = function(x, y, model, is_static){
	var m = unit_models[model] || unit_models['white'];
	var sprite = { texture: m.body, xScale: 0.5, yScale: 0.5 };
	var box = Matter.Bodies.rectangle(x, y, 40, 24, { render: { sprite: sprite } });

	var is_static = is_static || false;
	if (is_static) Matter.Body.setStatic(box, true);

	World.add(engine.world, [ box ]);

	var tower = {
		angle   : 0,
		element : $('<div class="tower" style="background-image: url('+m.tower+')"></div>').css({ top: y, left : x}).appendTo('#xmap')
	};
	tower.setAngle = function(e){ 
		tower.angle = e % 360;
		tower.element.css({ transform: 'rotate(' + (tower.angle + box.angle * 180 / Math.PI) + 'deg)'});
	};
	tower.setPoint = function(position){
		tower.element.css({ top: position.y, left : position.x });
	};
	var remove = function(){
		World.remove(engine.world, [ box ]);
		tower.element.remove();
	};
	var set = function(x){
		tower.setAngle(x[3]);
		Matter.Body.setPosition(box, {x : x[0], y : x[1]});
		Matter.Body.setAngle(box, x[2] * Math.PI / 180);
	};
	
	return {
		box    : box, 
		set    : set,
		tower  : tower, 
		speed  : [0, 0], 
		dead   : 5, 
		remove : remove,
		state  : [],
	}
};

// -------------------------------------------------------------------------- //

var socket = io.connect(location.origin + ':8913');
var unit = unit_create(300, 300);

var owners = {};
// !
var uid = false;
var fire = {'main' : 0, 'mini' : 0};

// Стеночки
World.add(engine.world, [
	Matter.Bodies.rectangle(map.size[0]/2, 5,               map.size[0], 10, { isStatic: true }),
	Matter.Bodies.rectangle(map.size[0]/2, map.size[1] - 5, map.size[0], 10, { isStatic: true }),
	Matter.Bodies.rectangle(5,               map.size[1]/2, 10, map.size[1], { isStatic: true }),
	Matter.Bodies.rectangle(map.size[0] - 5, map.size[1]/2, 10, map.size[1], { isStatic: true })
]);

// Карта
World.add(engine.world, [
	Matter.Bodies.rectangle(20,   50,  280,  20, { isStatic: true }),
	Matter.Bodies.rectangle(120,  150, 280,  20, { isStatic: true }),
	Matter.Bodies.rectangle(320,  250, 280,  20, { isStatic: true }),
	Matter.Bodies.rectangle(400,  200, 80,   80, { isStatic: true }),
	Matter.Bodies.rectangle(420,  450, 980,  20, { isStatic: true }),
	Matter.Bodies.rectangle(420,  550, 1080, 20, { isStatic: true }),
	Matter.Bodies.rectangle(1200, 400, 80,   80, { isStatic: true }),
	Matter.Bodies.rectangle(1450, 820, 980,  20, { isStatic: true }),
	Matter.Bodies.rectangle(1550, 120, 300,  40, { isStatic: true }),
	Matter.Bodies.rectangle(1550, 180, 300,  40, { isStatic: true })
]);

var w_offsets = { left : 0, top : 0};
var w_calc = function(pos, side, win, frame, prop){
	if (win > frame) return win/2 - frame/2;
	var tmp;
	tmp = pos + side - win * prop;
	if (tmp > 0) side -= tmp;
	tmp = - pos - side + win * (1 - prop);
	if (tmp > 0) side += tmp;
	if (side > 0) side = 0;
	if (side < win - frame) side = win - frame;
	return side;
}
var w_upadate = function(){
	w_offsets.left =  w_calc(unit.box.position.x, w_offsets.left,  window.innerWidth,  map.size[0], 0.7);
	w_offsets.top  =  w_calc(unit.box.position.y, w_offsets.top, window.innerHeight, map.size[1], 0.7);
	$('#xmap').css(w_offsets);
	$('#mini-window').css({
		width  : 120 * window.innerWidth / map.size[0],
		height : minimapHeight * window.innerHeight / map.size[1],
		left   : - w_offsets.left * 120 / map.size[0],
		top    : - w_offsets.top * minimapHeight / map.size[1]
	});
};
var draw_shot = function(from, to){
	render.context.beginPath();
	render.context.moveTo(from.x, from.y);
	render.context.lineTo(to.x, to.y);
	render.context.strokeStyle = 'rgba(0,0,0,0.05)';
	render.context.lineWidth = 5;
	render.context.stroke();
	$('#xmap').append(explosion(to, 'main'));
	
};
var make_shot = function(){
	var bodies = Matter.Composite.allBodies(engine.world).slice(1);
	var from = unit.box.position; 
	var to = find_collision_end(from, {
		x : from.x + map.size[0] * Math.cos(unit.tower.angle * Math.PI / 180 + unit.box.angle),
		y : from.y + map.size[0] * Math.sin(unit.tower.angle * Math.PI / 180 + unit.box.angle)
	}, bodies, 0);
	draw_shot(from, to);
};

socket.on('echo', function (timer) {
	socket.emit('echo', timer);
});

// Прилетела информация про одного пользователя
socket.on('user', function (cns) {
	var cns = cns.split(':');
	var cn  = cns[0];
	// Если видим впервые, создаём юнита на карте
	if (!owners[cn]) owners[cn] = unit_create(-999, -999, 'black', 'static');
	// Закидываем очередь состояний:
	owners[cn].coda = cns[1].split('!').map(function(pix){
		var xy = pix.split(',');
		return [parseInt(xy[0]), parseInt(xy[1]), parseInt(xy[2]), parseInt(xy[3])];
	});
	// Обновляем позицию из очереди
	owners[cn].set(owners[cn].coda[0]);
	owners[cn].coda = owners[cn].coda.splice(1);
});

Matter.Events.on(render, 'afterRender', function() {
	// - Сброс скорости
	unit.speed = [unit.speed[0] * 0.9, unit.speed[1] * 0.9];

	// - Синус, косинус поворота корпуса
	var ct = Math.cos(unit.box.angle);
	var st = Math.sin(unit.box.angle);

	// - Движение корпуса
	if (keys[38] || keys[87]) unit.speed[0] += 0.3 * ct, unit.speed[1] += 0.3 * st;
	if (keys[40] || keys[83]) unit.speed[0] -= 0.2 * ct, unit.speed[1] -= 0.2 * st;
	unit.speed[0] = Math.min(unit.speed[0], 6);
	unit.speed[1] = Math.min(unit.speed[1], 6);
	Matter.Body.setVelocity(unit.box, { x: unit.speed[0], y: unit.speed[1] });

	// - Поворот корпуса
	Matter.Body.setAngularVelocity(unit.box, 0);
	if (keys[37] || keys[65]) Matter.Body.setAngularVelocity(unit.box, -0.04);
	if (keys[39] || keys[68]) Matter.Body.setAngularVelocity(unit.box,  0.04);

	// - Поворот башни
	if (keys[81]) unit.tower.angle -= 2;
	if (keys[69]) unit.tower.angle += 2;

	unit.tower.setPoint(unit.box.position);
	unit.tower.setAngle(unit.tower.angle);

	// - Выстрел
	if (keys[32] && fire.main == 0) {
		make_shot();
		fire.main = 0;
	}
	
	var nx = [parseInt(unit.box.position.x), parseInt(unit.box.position.y)];
	// Угол корпуса 3
	nx.push(parseInt(((unit.box.angle * 180 / Math.PI) % 360 + 360) % 360));
	// Угол башни 4
	nx.push(parseInt(((unit.tower.angle) % 360 + 360) % 360));
	// В стрек
	unit.state.push(nx.join(','));

	// Рендерим башни наших коллег-соперников ;)
	for (var cn in owners) {
		if (owners[cn].coda.length == 0) continue ;
		owners[cn].set(owners[cn].coda[0]);
		owners[cn].coda = owners[cn].coda.splice(1);
		owners[cn].tower.setPoint(owners[cn].box.position);
		owners[cn].tower.setAngle(owners[cn].tower.angle);
	}
	
	w_upadate();
});

// -------------------------------------------------------------------------- //
window.onkeydown = function(e){ keys[e.which] = true; };
window.onkeyup = function(e){ keys[e.which] = undefined; };
window.onkeypress = function(e) {
	// Воскрешение при пробеле
	if (e.which == 32 && unit.dead === 0) {
		unit.dead = false;
		sleep.classList.add('hidden');
		Matter.Body.setPosition(unit.box, {x : 500, y : 200});
	}
}

// -------------------------------------------------------------------------- //
setInterval(function(){
	socket.emit('me', unit.state.join('!'));
	unit.state = [];
	return ;

	// Отправка состояний 1 2
	var nx = [parseInt(unit.box.position.x), parseInt(unit.box.position.y)];
	// Угол корпуса 3
	nx.push(parseInt(((unit.box.angle * 180 / Math.PI) % 360 + 360) % 360));
	// Угол башни 4
	nx.push(parseInt(((unit.tower.angle) % 360 + 360) % 360));
	// Скорость 5 6
	nx.push(Math.round(unit.speed[0] * 1000));
	nx.push(Math.round(unit.speed[1] * 1000));
	// Клавиши 7 8 9 10
	nx.push(keys[38] || keys[87] ? 1 : 0);
	nx.push(keys[40] || keys[83] ? 1 : 0);
	nx.push(keys[37] || keys[65] ? 1 : 0);
	nx.push(keys[39] || keys[68] ? 1 : 0);

	// Зачем такие извращенства? Экономим на байтах, передаваемых на сервер
	// Информация о юните в строке занимает меньше памяти чем в json-е ;)
	socket.emit('me', nx.join(':'));

	// Перезарядка
	if (fire.main) fire.main --;

	// Перерождение при смерти 5сек.:
	if (unit.dead) {
		sleep.innerHTML = 'Ожидайте: ' + unit.dead;
		return unit.dead -= 1;
	}
	sleep.innerHTML = 'Нажмите пробел для перерождения';
}, 400);




Matter.Engine.run(engine);
Matter.Render.run(render);
