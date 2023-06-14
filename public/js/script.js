selection = []
function select(x) {
    if (selection.length < 10) {
        if (selection.includes(x) == false) {
            document.getElementById(x).style.backgroundColor = '#FF7F50';
            selection.push(x)
        }
        else {
            document.getElementById(x).style.backgroundColor = 'white';
            const index = selection.indexOf(x);
            selection.splice(index, 1);
        }
        document.getElementById('chaps').value = selection
    }
    else {
        notif({
            msg: "Maximum 10 chapters can be downloaded at a time",
            type: "warning"
        });
    }
}

$(document).ready(function () {
    $('.selectpicker').selectpicker();
    $('.format').on('changed.bs.select', function (e) {
        e.stopImmediatePropagation();
        document.getElementById('format').value = $(this).val();
        document.getElementById('result').action = '/' + $(this).val();
        console.log('/' + $(this).val())
    });
    $('.quality').on('changed.bs.select', function (e) {
        e.stopImmediatePropagation();
        document.getElementById('quality').value = $(this).val();
    });
});

function once() {
    console.log(document.getElementById('result').action)
    if (selection.length > 0) {
        const elements = document.getElementsByClassName('deactivate');

        for (let i = 0; i < elements.length; i++) {
            elements[i].style.pointerEvents = 'none';
            elements[i].style.filter = 'brightness(50%)';
        }
        if (!['/CBZ', '/PDF', '/Raw'].includes(document.getElementById('result').action)) {
            document.getElementById('result').action = document.getElementById('format').value
        }
        console.log("hi")
        document.getElementById('result').method = "POST"
        document.getElementById("result").submit();
        document.getElementById('prog').style.width = '1%';
        document.getElementById('prog').innerHTML = '1%';
    }
    else {
        notif({
            msg: "Please select chapters to download.",
            type: "warning"
        });
    }
}

var socket = io();
const clientId = Math.random().toString(36).substr(2, 9);

console.log("script " + clientId)
socket.emit('clientId', clientId);

socket.on('prog', (data) => {
    totpages = data[1];
    donepages = data[0];
    client = data[2];
    progress = (donepages / totpages) * 100;
    console.log(progress)
    document.getElementById('prog').style.width = progress + '%';
    document.getElementById('prog').innerHTML = progress.toFixed(2) + '%';
});
socket.on('status', (data) => {
    document.getElementById('status').innerHTML = data;

});
socket.on('end', (data) => {
    document.getElementById('prog').style.width = '100%';
    document.getElementById('prog').innerHTML = "Complete!";
    document.getElementsById('chapList').style.pointerEvents = 'auto';
    $("prog").removeClass("progress-bar-animated");
});

function searchorurl(){
    id = document.getElementById('search').value;
    form = document.getElementById('searchorurl');
    console.log(id,form)
    if (id.includes("http")){
        form.action = "/getChapter"
    }
    else{
        form = document.getElementById('searchorurl').action = "/getManga"
    }
    form.submit();
}